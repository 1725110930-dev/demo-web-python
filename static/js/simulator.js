/*
 * Cañón lanzatomates
 * PixiJS 8 + Matter.js 0.19
 *
 * Recursos reales del proyecto:
 *   static/img/canon.png      -> tubo del cañón (gira)
 *   static/img/wheels.png     -> base y ruedas (permanecen fijas)
 *   static/img/missile_1.png  -> tomate/proyectil
 *   static/img/target_1.png   -> diana
 */

(() => {
  'use strict';

  const DESIGN = Object.freeze({ width: 1200, height: 800 });
  const GROUND_Y = 690;
  const PHYSICS_STEP = 1000 / 60;

  const ASSET_PATHS = Object.freeze({
    wheels: '/static/img/wheels.png',
    cannon: '/static/img/canon.png',
    tomato: '/static/img/missile_1.png',
    target: '/static/img/target_1.png',
  });

  /*
   * Las dos imágenes del cañón comparten el mismo lienzo (1166 x 912).
   * El tubo se coloca desplazado 102 px respecto a las ruedas para que su
   * eje de giro quede justo encima del centro de la cureña.
   */
  const CANNON = Object.freeze({
    scale: 0.32,
    baseX: 66,
    baseY: 372.68,
    barrelX: 134,
    barrelY: 372.68,
    pivot: { x: 300, y: 476 },
    muzzle: { x: 1060, y: 220 },
    minElevation: 5,
    maxElevation: 75,
    defaultElevation: 32,
  });

  const TARGET = Object.freeze({
    scale: 0.2,
    collisionRadius: 90,
    minX: 830,
    maxX: 1030,
    minY: 280,
    maxY: 520,
    respawnDelay: 720,
  });

  const PROJECTILE = Object.freeze({
    speed: 12.5,
    radius: 22,
    spriteScale: 0.06,
    life: 8,
    maxActive: 4,
    cooldown: 280,
    spawnOffset: 10,
  });

  const COLORS = Object.freeze({
    cyan: 0x38bdf8,
    success: 0x86efac,
    white: 0xf8fafc,
  });

  const state = {
    ready: false,
    score: 0,
    shots: 0,
    elevation: CANNON.defaultElevation,
    pointer: { x: DESIGN.width * 0.78, y: 350 },
    touchAiming: false,
    projectiles: [],
    pendingRemovals: [],
    acc: 0,
    cooldownUntil: 0,
    targetRespawnAt: 0,
    targetMove: null,
    targetFlash: 0,
    targetPulse: 0,
  };

  let app;
  let engine;
  let world;
  let scene;
  let cannonRoot;
  let baseSprite;
  let barrelPivot;
  let barrelSprite;
  let targetGroup;
  let targetSprite;
  let targetBody;
  let projectileLayer;
  let uiLayer;
  let groundBody;
  let textures;
  let tickHandler;
  let resizeHandler;
  let pointerHandlers;
  let keyHandler;

  const ui = {};

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rand = (min, max) => min + Math.random() * (max - min);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function currentTime() {
    return performance.now();
  }

  function makeText(text, options = {}) {
    const {
      size = 22,
      color = COLORS.white,
      weight = 'bold',
      align = 'left',
      letterSpacing = 0,
      strokeWidth = 0,
      lineHeight,
    } = options;

    const style = {
      fontFamily: 'Trebuchet MS, Segoe UI, Arial, sans-serif',
      fontSize: size,
      fontWeight: weight,
      fill: color,
      align,
      letterSpacing,
    };

    if (lineHeight) style.lineHeight = lineHeight;
    if (strokeWidth > 0) style.stroke = { color: 0x0b1220, width: strokeWidth };

    return new PIXI.Text({ text, style });
  }

  function showError(message) {
    const holder = document.createElement('div');
    holder.className = 'tomato-game-error';
    holder.innerHTML = `<strong>No se pudo iniciar el juego</strong><span>${message}</span>`;
    document.body.appendChild(holder);
  }

  async function loadAssets() {
    const [wheels, cannon, tomato, target] = await Promise.all([
      PIXI.Assets.load(ASSET_PATHS.wheels),
      PIXI.Assets.load(ASSET_PATHS.cannon),
      PIXI.Assets.load(ASSET_PATHS.tomato),
      PIXI.Assets.load(ASSET_PATHS.target),
    ]);

    return { wheels, cannon, tomato, target };
  }

  function createPhysics() {
    const { Engine, Bodies, Composite, Events } = Matter;

    engine = Engine.create();
    engine.gravity.x = 0;
    engine.gravity.y = 1;
    engine.gravity.scale = 0.001;
    engine.positionIterations = 10;
    engine.velocityIterations = 8;
    world = engine.world;

    groundBody = Bodies.rectangle(
      DESIGN.width / 2,
      GROUND_Y + 90,
      DESIGN.width + 600,
      180,
      {
        isStatic: true,
        label: 'ground',
        friction: 0.85,
        restitution: 0.12,
      },
    );

    Composite.add(world, groundBody);
    Events.on(engine, 'collisionStart', handleCollisions);
  }

  function createCannon() {
    cannonRoot = new PIXI.Container();
    cannonRoot.position.set(CANNON.baseX, CANNON.baseY);
    scene.addChild(cannonRoot);

    baseSprite = new PIXI.Sprite(textures.wheels);
    baseSprite.anchor.set(0, 0);
    baseSprite.scale.set(CANNON.scale);
    baseSprite.rotation = 0;
    cannonRoot.addChild(baseSprite);

    barrelPivot = new PIXI.Container();
    barrelPivot.position.set(
      CANNON.barrelX - CANNON.baseX + CANNON.pivot.x * CANNON.scale,
      CANNON.barrelY - CANNON.baseY + CANNON.pivot.y * CANNON.scale,
    );
    cannonRoot.addChild(barrelPivot);

    barrelSprite = new PIXI.Sprite(textures.cannon);
    barrelSprite.anchor.set(
      CANNON.pivot.x / textures.cannon.width,
      CANNON.pivot.y / textures.cannon.height,
    );
    barrelSprite.scale.set(CANNON.scale);
    barrelSprite.position.set(0, 0);
    barrelPivot.addChild(barrelSprite);

    setElevation(CANNON.defaultElevation);
  }

  function createTarget() {
    targetGroup = new PIXI.Container();
    scene.addChild(targetGroup);

    targetSprite = new PIXI.Sprite(textures.target);
    targetSprite.anchor.set(0.5);
    targetSprite.scale.set(TARGET.scale);
    targetGroup.addChild(targetSprite);

    const start = pickTargetPosition(null);
    targetGroup.position.set(start.x, start.y);

    targetBody = Matter.Bodies.circle(start.x, start.y, TARGET.collisionRadius, {
      isStatic: true,
      label: 'target',
      friction: 0.4,
      restitution: 0.25,
    });
    Matter.Composite.add(world, targetBody);
  }

  function pickTargetPosition(previous) {
    let candidate = null;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      candidate = {
        x: rand(TARGET.minX, TARGET.maxX),
        y: rand(TARGET.minY, TARGET.maxY),
      };

      if (!previous || distance(candidate, previous) > 120) {
        return candidate;
      }
    }

    return candidate;
  }

  function setTargetPosition(x, y) {
    const clampedX = clamp(x, TARGET.minX, TARGET.maxX);
    const clampedY = clamp(y, TARGET.minY, TARGET.maxY);

    targetGroup.position.set(clampedX, clampedY);

    if (targetBody) {
      Matter.Body.setPosition(targetBody, { x: clampedX, y: clampedY });
    }
  }

  function createUI() {
    uiLayer = new PIXI.Container();
    scene.addChild(uiLayer);

    const labelStyle = {
      size: 13,
      weight: 'bold',
      color: COLORS.cyan,
      letterSpacing: 2,
    };

    ui.scoreLabel = makeText('PUNTUACIÓN', labelStyle);
    ui.scoreLabel.position.set(32, 24);
    uiLayer.addChild(ui.scoreLabel);

    ui.scoreValue = makeText('0', { size: 34, color: COLORS.white, weight: 'bold' });
    ui.scoreValue.position.set(32, 43);
    uiLayer.addChild(ui.scoreValue);

    ui.shotsLabel = makeText('DISPAROS', labelStyle);
    ui.shotsLabel.position.set(230, 24);
    uiLayer.addChild(ui.shotsLabel);

    ui.shotsValue = makeText('0', { size: 34, color: COLORS.white, weight: 'bold' });
    ui.shotsValue.position.set(230, 43);
    uiLayer.addChild(ui.shotsValue);

    ui.angleLabel = makeText('ÁNGULO', labelStyle);
    ui.angleLabel.position.set(400, 24);
    uiLayer.addChild(ui.angleLabel);

    ui.angleValue = makeText(`${CANNON.defaultElevation}°`, {
      size: 34,
      color: COLORS.success,
      weight: 'bold',
    });
    ui.angleValue.position.set(400, 43);
    uiLayer.addChild(ui.angleValue);
  }

  function getPivotWorld() {
    return {
      x: cannonRoot.x + barrelPivot.x,
      y: cannonRoot.y + barrelPivot.y,
    };
  }

  function getBoreAngle() {
    return -state.elevation * (Math.PI / 180);
  }

  function getMuzzleWorld() {
    const pivot = getPivotWorld();
    const rotation = barrelPivot.rotation;
    const offsetX = (CANNON.muzzle.x - CANNON.pivot.x) * CANNON.scale;
    const offsetY = (CANNON.muzzle.y - CANNON.pivot.y) * CANNON.scale;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    return {
      x: pivot.x + offsetX * cos - offsetY * sin,
      y: pivot.y + offsetX * sin + offsetY * cos,
    };
  }

  function setElevation(degrees) {
    const elevation = clamp(degrees, CANNON.minElevation, CANNON.maxElevation);
    state.elevation = elevation;

    if (barrelPivot) {
      const screenAngle = -elevation * (Math.PI / 180);
      const baseAngle = Math.atan2(
        CANNON.muzzle.y - CANNON.pivot.y,
        CANNON.muzzle.x - CANNON.pivot.x,
      );
      barrelPivot.rotation = screenAngle - baseAngle;
    }

    updateUI();
  }

  function aimAtPointer(point) {
    const pivot = getPivotWorld();
    const dx = point.x - pivot.x;
    const dy = point.y - pivot.y;
    let elevation;

    if (dx < 1) {
      elevation = dy < 0 ? CANNON.maxElevation : CANNON.minElevation;
    } else {
      elevation = (-Math.atan2(dy, dx) * 180) / Math.PI;
    }

    state.pointer.x = point.x;
    state.pointer.y = point.y;
    setElevation(elevation);
  }

  function updateUI() {
    if (!ui.scoreValue) return;

    ui.scoreValue.text = String(state.score);
    ui.shotsValue.text = String(state.shots);
    ui.angleValue.text = `${Math.round(state.elevation)}°`;
  }

  function createTomato(angle, muzzle) {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const spawnX = muzzle.x + dirX * PROJECTILE.spawnOffset;
    const spawnY = muzzle.y + dirY * PROJECTILE.spawnOffset;

    const body = Matter.Bodies.circle(spawnX, spawnY, PROJECTILE.radius, {
      label: 'tomato',
      friction: 0.55,
      frictionAir: 0,
      restitution: 0.32,
      density: 0.002,
      slop: 0.02,
    });

    Matter.Body.setAngle(body, angle);
    Matter.Body.setVelocity(body, {
      x: dirX * PROJECTILE.speed,
      y: dirY * PROJECTILE.speed,
    });
    Matter.Body.setAngularVelocity(body, rand(-0.16, 0.16));
    Matter.Composite.add(world, body);

    const sprite = new PIXI.Sprite(textures.tomato);
    sprite.anchor.set(0.5);
    sprite.scale.set(PROJECTILE.spriteScale);
    sprite.position.set(spawnX, spawnY);
    sprite.rotation = angle;
    projectileLayer.addChild(sprite);

    return {
      body,
      sprite,
      life: PROJECTILE.life,
      removed: false,
    };
  }

  function fireTomato() {
    if (!state.ready) return;

    const now = currentTime();
    if (now < state.cooldownUntil) return;
    state.cooldownUntil = now + PROJECTILE.cooldown;

    while (state.projectiles.length >= PROJECTILE.maxActive) {
      removeProjectileImmediately(state.projectiles[0], false);
    }

    const angle = getBoreAngle();
    const muzzle = getMuzzleWorld();
    const actor = createTomato(angle, muzzle);

    state.projectiles.push(actor);
    state.shots += 1;
    updateUI();
  }

  function queueProjectileRemoval(actor) {
    if (!actor || actor.removed) return;
    actor.removed = true;
    state.pendingRemovals.push(actor);
  }

  function removeProjectileImmediately(actor, destroySprite = true) {
    if (!actor) return;
    actor.removed = true;

    Matter.Composite.remove(world, actor.body);

    const index = state.projectiles.indexOf(actor);
    if (index >= 0) state.projectiles.splice(index, 1);

    if (destroySprite && actor.sprite) {
      if (actor.sprite.parent) actor.sprite.parent.removeChild(actor.sprite);
      actor.sprite.destroy();
    }
  }

  function processPendingRemovals() {
    if (!state.pendingRemovals.length) return;

    const pending = state.pendingRemovals.splice(0);
    for (const actor of pending) {
      removeProjectileImmediately(actor, true);
    }
  }

  function handleCollisions(event) {
    for (const pair of event.pairs) {
      const { bodyA, bodyB } = pair;
      let tomatoBody = null;
      let otherBody = null;

      if (bodyA.label === 'tomato') {
        tomatoBody = bodyA;
        otherBody = bodyB;
      } else if (bodyB.label === 'tomato') {
        tomatoBody = bodyB;
        otherBody = bodyA;
      }

      if (!tomatoBody || !otherBody) continue;

      const actor = state.projectiles.find((item) => item.body === tomatoBody);
      if (!actor || actor.removed) continue;

      if (otherBody.label === 'target') {
        handleTargetHit(actor);
      } else if (otherBody.label === 'ground') {
        handleGroundHit(actor);
      }
    }
  }

  function handleTargetHit(actor) {
    const hitPoint = { x: actor.body.position.x, y: actor.body.position.y };
    const targetCenter = { x: targetGroup.x, y: targetGroup.y };
    const offset = distance(hitPoint, targetCenter);
    const ratio = offset / TARGET.collisionRadius;

    let points = 50;

    if (ratio <= 0.35) {
      points = 150;
    } else if (ratio <= 0.7) {
      points = 100;
    }

    state.score += points;
    state.targetFlash = 1;
    state.targetPulse = 1;
    state.targetRespawnAt = currentTime() + TARGET.respawnDelay;
    queueProjectileRemoval(actor);
  }

  function handleGroundHit(actor) {
    queueProjectileRemoval(actor);
  }

  function updatePhysics(deltaMS) {
    state.acc += Math.min(deltaMS, 90);

    let steps = 0;
    while (state.acc >= PHYSICS_STEP && steps < 5) {
      Matter.Engine.update(engine, PHYSICS_STEP);
      processPendingRemovals();
      state.acc -= PHYSICS_STEP;
      steps += 1;
    }

    if (steps === 5) state.acc = 0;
  }

  function updateProjectiles(deltaSeconds) {
    for (let i = state.projectiles.length - 1; i >= 0; i -= 1) {
      const actor = state.projectiles[i];
      if (actor.removed) continue;

      actor.life -= deltaSeconds;
      const body = actor.body;

      if (
        actor.life <= 0 ||
        body.position.x < -220 ||
        body.position.x > DESIGN.width + 220 ||
        body.position.y < -500 ||
        body.position.y > DESIGN.height + 260
      ) {
        removeProjectileImmediately(actor, true);
        continue;
      }

      actor.sprite.position.set(body.position.x, body.position.y);
      actor.sprite.rotation = body.angle;
    }
  }

  function updateTarget(deltaSeconds) {
    if (!targetGroup) return;

    if (state.targetMove) {
      const move = state.targetMove;
      move.elapsed += deltaSeconds;
      const t = clamp(move.elapsed / move.duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const x = move.fromX + (move.toX - move.fromX) * eased;
      const y = move.fromY + (move.toY - move.fromY) * eased;

      setTargetPosition(x, y);

      if (t >= 1) {
        state.targetMove = null;
      }
    } else if (state.targetRespawnAt > 0 && currentTime() >= state.targetRespawnAt) {
      state.targetRespawnAt = 0;
      const current = { x: targetGroup.x, y: targetGroup.y };
      const next = pickTargetPosition(current);

      state.targetMove = {
        fromX: current.x,
        fromY: current.y,
        toX: next.x,
        toY: next.y,
        elapsed: 0,
        duration: 0.55,
      };
    }

    state.targetFlash = Math.max(0, state.targetFlash - deltaSeconds * 4.5);
    state.targetPulse = Math.max(0, state.targetPulse - deltaSeconds * 2.4);

    targetSprite.tint = state.targetFlash > 0 ? 0xffb4b4 : 0xffffff;
    targetGroup.scale.set(1 + state.targetPulse * 0.09);
  }

  function updateVisuals(deltaSeconds) {
    updateProjectiles(deltaSeconds);
    updateTarget(deltaSeconds);
  }

  function tick(ticker) {
    if (!state.ready) return;

    const deltaMS = Math.min(ticker.deltaMS || PHYSICS_STEP, 80);
    const deltaSeconds = deltaMS / 1000;

    updatePhysics(deltaMS);
    updateVisuals(deltaSeconds);
  }

  function scenePointer(event) {
    const rect = app.canvas.getBoundingClientRect();
    const screenPoint = new PIXI.Point(
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    return scene.toLocal(screenPoint);
  }

  function bindInput() {
    const canvas = app.canvas;
    canvas.style.touchAction = 'none';

    const onPointerMove = (event) => {
      if (!state.ready) return;

      const point = scenePointer(event);
      if (event.pointerType === 'mouse' || state.touchAiming) {
        aimAtPointer(point);
      }

      if (event.pointerType !== 'mouse' && state.touchAiming) {
        event.preventDefault();
      }
    };

    const onPointerDown = (event) => {
      if (!state.ready) return;

      const point = scenePointer(event);
      if (event.pointerType === 'mouse') {
        if (event.button !== 0) return;
        aimAtPointer(point);
        fireTomato();
      } else {
        state.touchAiming = true;
        aimAtPointer(point);
        if (canvas.setPointerCapture) {
          canvas.setPointerCapture(event.pointerId);
        }
        event.preventDefault();
      }
    };

    const onPointerUp = (event) => {
      if (!state.ready || event.pointerType === 'mouse') return;
      if (!state.touchAiming) return;

      state.touchAiming = false;
      const point = scenePointer(event);
      aimAtPointer(point);
      fireTomato();
      event.preventDefault();
    };

    const onPointerCancel = () => {
      state.touchAiming = false;
    };

    const onContextMenu = (event) => event.preventDefault();

    const onKeyDown = (event) => {
      if (!state.ready) return;

      if (event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) fireTomato();
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault();
        setElevation(state.elevation - 2);
      } else if (event.code === 'ArrowRight') {
        event.preventDefault();
        setElevation(state.elevation + 2);
      } else if (event.code === 'KeyR') {
        event.preventDefault();
        if (!event.repeat) resetGame();
      }
    };

    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointerup', onPointerUp, { passive: false });
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);

    pointerHandlers = {
      onPointerMove,
      onPointerDown,
      onPointerUp,
      onPointerCancel,
      onContextMenu,
    };
    keyHandler = onKeyDown;
  }

  function resetGame() {
    for (const actor of state.projectiles.slice()) {
      removeProjectileImmediately(actor, true);
    }
    state.projectiles.length = 0;
    state.pendingRemovals.length = 0;
    state.score = 0;
    state.shots = 0;
    state.acc = 0;
    state.cooldownUntil = 0;
    state.targetRespawnAt = 0;
    state.targetMove = null;
    state.targetFlash = 0;
    state.targetPulse = 0;

    if (targetSprite) {
      targetSprite.tint = 0xffffff;
    }
    if (targetGroup) {
      targetGroup.scale.set(1);
    }

    const current = { x: targetGroup.x, y: targetGroup.y };
    const next = pickTargetPosition(current);
    setTargetPosition(next.x, next.y);
    setElevation(CANNON.defaultElevation);
    updateUI();
  }

  function resizeScene() {
    if (!app || !scene) return;

    const scale = Math.min(
      app.screen.width / DESIGN.width,
      app.screen.height / DESIGN.height,
    );

    scene.scale.set(scale);
    scene.position.set(
      (app.screen.width - DESIGN.width * scale) / 2,
      (app.screen.height - DESIGN.height * scale) / 2,
    );
  }

  function exposeDebugApi() {
    if (!new URLSearchParams(window.location.search).has('debug')) return;

    window.__tomatoGame = {
      get ready() {
        return state.ready;
      },
      getState() {
        return {
          ready: state.ready,
          score: state.score,
          shots: state.shots,
          elevation: state.elevation,
          baseRotation: baseSprite ? baseSprite.rotation : null,
          barrelRotation: barrelPivot ? barrelPivot.rotation : null,
          pivot: getPivotWorld(),
          muzzle: getMuzzleWorld(),
          pointer: { ...state.pointer },
          target: targetGroup ? { x: targetGroup.x, y: targetGroup.y } : null,
          targetBody: targetBody
            ? { x: targetBody.position.x, y: targetBody.position.y }
            : null,
          projectiles: state.projectiles.map((actor) => ({
            x: actor.body.position.x,
            y: actor.body.position.y,
            vx: actor.body.velocity.x,
            vy: actor.body.velocity.y,
          })),
        };
      },
      setElevation,
      setPointer(x, y) {
        aimAtPointer({ x, y });
      },
      setTarget(x, y) {
        setTargetPosition(x, y);
      },
      fire: fireTomato,
      reset: resetGame,
      getTargetRange() {
        return {
          minX: TARGET.minX,
          maxX: TARGET.maxX,
          minY: TARGET.minY,
          maxY: TARGET.maxY,
        };
      },
    };
  }

  function cleanup() {
    if (app) {
      if (tickHandler) app.ticker.remove(tickHandler);
      app.destroy(true, { children: true, texture: false });
    }
    if (engine) Matter.Engine.clear(engine);
    window.removeEventListener('resize', resizeHandler);
    window.removeEventListener('keydown', keyHandler);
    app = null;
    engine = null;
    world = null;
  }

  async function boot() {
    if (document.body.dataset.tomatoGame === 'ready') return;
    document.body.dataset.tomatoGame = 'loading';

    if (typeof PIXI === 'undefined' || typeof Matter === 'undefined') {
      showError('No se pudieron cargar PixiJS o Matter.js desde el CDN.');
      document.body.dataset.tomatoGame = 'error';
      return;
    }

    try {
      app = new PIXI.Application();
      await app.init({
        resizeTo: window,
        antialias: true,
        backgroundAlpha: 0,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        powerPreference: 'high-performance',
      });

      app.canvas.setAttribute('aria-label', 'Juego de tiro al blanco con cañón lanzatomates');
      document.body.appendChild(app.canvas);

      scene = new PIXI.Container();
      app.stage.addChild(scene);

      resizeScene();
      resizeHandler = resizeScene;
      window.addEventListener('resize', resizeHandler);

      textures = await loadAssets();
      createPhysics();
      createTarget();
      createCannon();

      projectileLayer = new PIXI.Container();
      scene.addChild(projectileLayer);

      createUI();

      bindInput();
      updateUI();
      setElevation(CANNON.defaultElevation);

      tickHandler = tick;
      app.ticker.add(tickHandler);

      state.ready = true;
      document.body.dataset.tomatoGame = 'ready';
      exposeDebugApi();

      window.addEventListener('pagehide', cleanup, { once: true });
      console.log('Cañón lanzatomates listo. PixiJS', PIXI.VERSION, '· Matter.js', Matter.version);
    } catch (error) {
      console.error('Error al iniciar el juego:', error);
      showError(error instanceof Error ? error.message : String(error));
      document.body.dataset.tomatoGame = 'error';
    }
  }

  window.addEventListener('load', boot, { once: true });
})();
