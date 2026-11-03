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
  const GRAVITY_PER_STEP = 0.001 * PHYSICS_STEP * PHYSICS_STEP;

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
    scale: 0.48,
    baseX: 60,
    baseY: 228.5,
    barrelX: 162,
    barrelY: 228.5,
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
    radius: 18,
    spriteScale: 0.05,
    life: 8,
    maxActive: 4,
    cooldown: 280,
    spawnOffset: 10,
  });

  const COLORS = Object.freeze({
    ink: 0x07111f,
    panel: 0x071628,
    cyan: 0x38bdf8,
    gold: 0xfbbf24,
    tomato: 0xef4444,
    success: 0x86efac,
    danger: 0xff8a80,
    white: 0xf8fafc,
  });

  const state = {
    ready: false,
    score: 0,
    shots: 0,
    elevation: CANNON.defaultElevation,
    pointer: { x: DESIGN.width * 0.78, y: 350 },
    pointerActive: false,
    touchAiming: false,
    projectiles: [],
    particles: [],
    pendingRemovals: [],
    acc: 0,
    elapsed: 0,
    cooldownUntil: 0,
    targetRespawnAt: 0,
    targetMove: null,
    targetFlash: 0,
    targetPulse: 0,
    messageTime: 0,
    nextMissMessage: 0,
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
  let targetGlow;
  let targetStand;
  let targetBody;
  let aimGraphics;
  let projectileLayer;
  let particleLayer;
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

  function mixColor(colorA, colorB, t) {
    const ar = (colorA >> 16) & 0xff;
    const ag = (colorA >> 8) & 0xff;
    const ab = colorA & 0xff;
    const br = (colorB >> 16) & 0xff;
    const bg = (colorB >> 8) & 0xff;
    const bb = colorB & 0xff;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const b = Math.round(ab + (bb - ab) * t);
    return (r << 16) | (g << 8) | b;
  }

  function sampleGradient(stops, t) {
    for (let i = 0; i < stops.length - 1; i += 1) {
      const from = stops[i];
      const to = stops[i + 1];
      if (t >= from.at && t <= to.at) {
        const local = (t - from.at) / Math.max(0.0001, to.at - from.at);
        return mixColor(from.color, to.color, local);
      }
    }
    return stops[stops.length - 1].color;
  }

  function fillVerticalGradient(graphics, x, y, width, height, stops) {
    const bands = 52;
    for (let i = 0; i < bands; i += 1) {
      const t = i / (bands - 1);
      const bandHeight = Math.ceil(height / bands) + 1;
      graphics.rect(x, y + (height * i) / bands, width, bandHeight);
      graphics.fill(sampleGradient(stops, t));
    }
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

  function createBackground() {
    const layer = new PIXI.Container();
    scene.addChild(layer);

    const sky = new PIXI.Graphics();
    fillVerticalGradient(sky, 0, 0, DESIGN.width, GROUND_Y, [
      { at: 0, color: 0x07111f },
      { at: 0.38, color: 0x123b69 },
      { at: 0.7, color: 0x2a7bc4 },
      { at: 1, color: 0x9fd8f5 },
    ]);
    layer.addChild(sky);

    const glow = new PIXI.Graphics();
    glow.circle(1010, 150, 180).fill({ color: 0xffe8a3, alpha: 0.055 });
    glow.circle(1010, 150, 125).fill({ color: 0xffe8a3, alpha: 0.08 });
    glow.circle(1010, 150, 82).fill({ color: 0xfff3c4, alpha: 0.13 });
    glow.circle(1010, 150, 48).fill({ color: 0xfffbeb, alpha: 0.95 });
    layer.addChild(glow);

    const clouds = new PIXI.Graphics();
    const cloud = (x, y, size, alpha) => {
      clouds.ellipse(x, y, 72 * size, 26 * size).fill({ color: 0xffffff, alpha });
      clouds.ellipse(x - 50 * size, y + 5 * size, 42 * size, 21 * size).fill({ color: 0xffffff, alpha });
      clouds.ellipse(x + 48 * size, y + 8 * size, 50 * size, 20 * size).fill({ color: 0xffffff, alpha });
      clouds.ellipse(x + 8 * size, y - 17 * size, 46 * size, 27 * size).fill({ color: 0xffffff, alpha });
    };
    cloud(180, 135, 1.15, 0.1);
    cloud(520, 96, 0.82, 0.075);
    cloud(820, 195, 0.95, 0.085);
    cloud(1090, 70, 0.65, 0.065);
    layer.addChild(clouds);

    const mountainsBack = new PIXI.Graphics();
    mountainsBack.poly([
      -80, GROUND_Y,
      -80, 555,
      95, 430,
      250, 565,
      390, 455,
      545, 590,
      720, 465,
      910, 580,
      1070, 445,
      1280, 585,
      1280, GROUND_Y,
    ]).fill({ color: 0x183a59, alpha: 0.85 });
    layer.addChild(mountainsBack);

    const mountainsFront = new PIXI.Graphics();
    mountainsFront.poly([
      -80, GROUND_Y,
      -80, 620,
      150, 520,
      330, 635,
      500, 535,
      690, 650,
      850, 545,
      1030, 650,
      1190, 535,
      1280, 610,
      1280, GROUND_Y,
    ]).fill({ color: 0x14533f, alpha: 0.9 });
    layer.addChild(mountainsFront);

    const haze = new PIXI.Graphics();
    haze.rect(0, GROUND_Y - 35, DESIGN.width, 35).fill({ color: 0xbce7f7, alpha: 0.12 });
    layer.addChild(haze);
  }

  function createGround() {
    const layer = new PIXI.Container();
    scene.addChild(layer);

    const dirt = new PIXI.Graphics();
    fillVerticalGradient(dirt, 0, GROUND_Y, DESIGN.width, DESIGN.height - GROUND_Y, [
      { at: 0, color: 0x315127 },
      { at: 0.12, color: 0x4c6b2d },
      { at: 0.3, color: 0x5a3b23 },
      { at: 1, color: 0x2b1a10 },
    ]);
    layer.addChild(dirt);

    const grass = new PIXI.Graphics();
    grass.rect(0, GROUND_Y, DESIGN.width, 15).fill(0x2f8f46);
    grass.rect(0, GROUND_Y + 15, DESIGN.width, 6).fill({ color: 0x1d6b33, alpha: 0.9 });
    layer.addChild(grass);

    const texture = new PIXI.Graphics();
    for (let i = 0; i < 58; i += 1) {
      const x = (i * 173 + 41) % DESIGN.width;
      const y = GROUND_Y + 34 + ((i * 89) % 70);
      const length = 5 + (i % 4) * 3;
      texture.moveTo(x, y).lineTo(x - 3, y - length).stroke({
        width: 1,
        color: 0x8a6a45,
        alpha: 0.24,
      });
    }
    for (let i = 0; i < 30; i += 1) {
      const x = (i * 211 + 70) % DESIGN.width;
      const y = GROUND_Y + 8 + (i % 3) * 3;
      const height = 7 + (i % 5) * 2;
      texture.moveTo(x, y).lineTo(x - 3, y - height).stroke({
        width: 2,
        color: 0x3ba55a,
        alpha: 0.55,
      });
      texture.moveTo(x, y).lineTo(x + 3, y - height + 2).stroke({
        width: 2,
        color: 0x5cc977,
        alpha: 0.4,
      });
    }
    layer.addChild(texture);
  }

  function createForegroundMound() {
    const layer = new PIXI.Container();
    scene.addChild(layer);

    const mound = new PIXI.Graphics();
    mound.poly([
      -80, DESIGN.height + 20,
      -80, 660,
      515, 660,
      600, 664,
      690, 700,
      735, DESIGN.height + 20,
    ]).fill(0x1c3b24);

    mound.moveTo(-80, 661).lineTo(515, 661).quadraticCurveTo(600, 665, 690, 701).stroke({
      width: 9,
      color: 0x3a8f4f,
      alpha: 0.95,
    });

    mound.moveTo(-80, 675).lineTo(500, 675).stroke({
      width: 2,
      color: 0x63b86f,
      alpha: 0.22,
    });

    for (let i = 0; i < 34; i += 1) {
      const x = -40 + i * 20;
      const top = 660 + Math.max(0, (x - 500) * 0.12);
      const blade = 5 + (i % 4) * 3;
      mound.moveTo(x, top).lineTo(x - 3, top - blade).stroke({
        width: 2,
        color: i % 2 ? 0x65cc74 : 0x3da354,
        alpha: 0.5,
      });
    }
    layer.addChild(mound);
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

  function drawTargetStand(x, y) {
    if (!targetStand) return;

    const top = y + TARGET.collisionRadius * 0.74;
    targetStand.clear();

    targetStand.moveTo(x, top).lineTo(x, GROUND_Y - 7).stroke({
      width: 11,
      color: 0x334155,
    });
    targetStand.moveTo(x, top).lineTo(x, GROUND_Y - 7).stroke({
      width: 4,
      color: 0x64748b,
      alpha: 0.75,
    });

    targetStand.moveTo(x - 32, top).lineTo(x + 32, top).stroke({
      width: 7,
      color: 0x475569,
    });

    targetStand.moveTo(x - 30, GROUND_Y - 8).lineTo(x + 30, GROUND_Y - 8).stroke({
      width: 9,
      color: 0x1e293b,
    });
    targetStand.ellipse(x, GROUND_Y - 2, 42, 11).fill({
      color: 0x0b1220,
      alpha: 0.5,
    });
  }

  function createTarget() {
    targetStand = new PIXI.Graphics();
    scene.addChild(targetStand);

    targetGroup = new PIXI.Container();
    scene.addChild(targetGroup);

    targetGlow = new PIXI.Graphics();
    targetGlow.circle(0, 0, TARGET.collisionRadius * 1.36).fill({
      color: COLORS.gold,
      alpha: 0.12,
    });
    targetGlow.circle(0, 0, TARGET.collisionRadius * 1.18).stroke({
      width: 2,
      color: COLORS.gold,
      alpha: 0.4,
    });
    targetGroup.addChild(targetGlow);

    targetSprite = new PIXI.Sprite(textures.target);
    targetSprite.anchor.set(0.5);
    targetSprite.scale.set(TARGET.scale);
    targetGroup.addChild(targetSprite);

    const start = pickTargetPosition(null);
    targetGroup.position.set(start.x, start.y);
    drawTargetStand(start.x, start.y);

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

  function setTargetPosition(x, y, updateStand = true) {
    const clampedX = clamp(x, TARGET.minX, TARGET.maxX);
    const clampedY = clamp(y, TARGET.minY, TARGET.maxY);

    targetGroup.position.set(clampedX, clampedY);

    if (targetBody) {
      Matter.Body.setPosition(targetBody, { x: clampedX, y: clampedY });
    }
    if (updateStand) {
      drawTargetStand(clampedX, clampedY);
    }
  }

  function createAimIndicator() {
    aimGraphics = new PIXI.Graphics();
    scene.addChild(aimGraphics);
  }

  function createUI() {
    uiLayer = new PIXI.Container();
    scene.addChild(uiLayer);

    const panel = (x, y, width, height, accent) => {
      const graphics = new PIXI.Graphics();
      graphics.roundRect(x, y, width, height, 17).fill({
        color: COLORS.panel,
        alpha: 0.76,
      });
      graphics.roundRect(x, y, width, height, 17).stroke({
        width: 1.5,
        color: COLORS.cyan,
        alpha: 0.28,
      });
      graphics.roundRect(x + 14, y + 13, 4, height - 26, 2).fill({
        color: accent,
        alpha: 0.95,
      });
      uiLayer.addChild(graphics);
    };

    panel(28, 22, 300, 82, COLORS.cyan);
    panel(346, 22, 240, 82, COLORS.gold);
    panel(604, 22, 240, 82, COLORS.success);

    const labelStyle = {
      size: 13,
      weight: 'bold',
      color: 0x93c5fd,
      letterSpacing: 2,
    };

    ui.scoreLabel = makeText('PUNTUACIÓN', labelStyle);
    ui.scoreLabel.position.set(54, 34);
    uiLayer.addChild(ui.scoreLabel);

    ui.scoreValue = makeText('0', { size: 34, color: COLORS.white, weight: 'bold' });
    ui.scoreValue.position.set(54, 53);
    uiLayer.addChild(ui.scoreValue);

    ui.shotsLabel = makeText('DISPAROS', labelStyle);
    ui.shotsLabel.position.set(372, 34);
    uiLayer.addChild(ui.shotsLabel);

    ui.shotsValue = makeText('0', { size: 34, color: COLORS.white, weight: 'bold' });
    ui.shotsValue.position.set(372, 53);
    uiLayer.addChild(ui.shotsValue);

    ui.angleLabel = makeText('ÁNGULO', labelStyle);
    ui.angleLabel.position.set(630, 34);
    uiLayer.addChild(ui.angleLabel);

    ui.angleValue = makeText(`${CANNON.defaultElevation}°`, {
      size: 34,
      color: COLORS.success,
      weight: 'bold',
    });
    ui.angleValue.position.set(630, 53);
    uiLayer.addChild(ui.angleValue);

    ui.message = makeText('', {
      size: 52,
      color: COLORS.white,
      weight: 'bold',
      align: 'center',
      strokeWidth: 8,
    });
    ui.message.anchor.set(0.5);
    ui.message.position.set(DESIGN.width / 2, 176);
    ui.message.alpha = 0;
    uiLayer.addChild(ui.message);

    const helpPanel = new PIXI.Graphics();
    helpPanel.roundRect(218, 735, 764, 50, 22).fill({
      color: COLORS.panel,
      alpha: 0.72,
    });
    helpPanel.roundRect(218, 735, 764, 50, 22).stroke({
      width: 1.2,
      color: COLORS.cyan,
      alpha: 0.22,
    });
    uiLayer.addChild(helpPanel);

    ui.help = makeText(
      'Mueve el ratón para apuntar  ·  Clic / Espacio para disparar\n← → ajustan el ángulo  ·  R reinicia la partida',
      { size: 15, color: 0xcbd5e1, weight: 'bold', align: 'center', lineHeight: 21 },
    );
    ui.help.anchor.set(0.5);
    ui.help.position.set(DESIGN.width / 2, 760);
    uiLayer.addChild(ui.help);
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
    state.pointerActive = true;
    setElevation(elevation);
  }

  function updateUI() {
    if (!ui.scoreValue) return;

    ui.scoreValue.text = String(state.score);
    ui.shotsValue.text = String(state.shots);
    ui.angleValue.text = `${Math.round(state.elevation)}°`;
  }

  function showMessage(text, color = COLORS.gold) {
    if (!ui.message) return;

    ui.message.text = text;
    ui.message.tint = color;
    ui.message.alpha = 1;
    ui.message.position.set(DESIGN.width / 2, 176);
    ui.message.scale.set(1);
    state.messageTime = 1.75;
  }

  function spawnParticles(x, y, color, count, options = {}) {
    if (!particleLayer) return;

    const {
      minSpeed = 70,
      maxSpeed = 310,
      minSize = 2,
      maxSize = 6,
      gravity = 620,
      minLife = 0.35,
      maxLife = 0.9,
    } = options;

    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(minSpeed, maxSpeed);
      const size = rand(minSize, maxSize);
      const life = rand(minLife, maxLife);
      const graphics = new PIXI.Graphics();
      graphics.circle(0, 0, size).fill({ color, alpha: 1 });
      graphics.position.set(x, y);
      particleLayer.addChild(graphics);

      state.particles.push({
        graphics,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (options.upBias || 0),
        gravity,
        life,
        maxLife: life,
        size,
      });
    }
  }

  function spawnMuzzleFlash(muzzle, angle) {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    spawnParticles(muzzle.x + dirX * 12, muzzle.y + dirY * 12, 0xffb347, 9, {
      minSpeed: 30,
      maxSpeed: 150,
      minSize: 1.5,
      maxSize: 4.5,
      gravity: 250,
      minLife: 0.18,
      maxLife: 0.4,
    });
    spawnParticles(muzzle.x + dirX * 18, muzzle.y + dirY * 18, 0xef4444, 5, {
      minSpeed: 20,
      maxSpeed: 90,
      minSize: 1,
      maxSize: 3,
      gravity: 300,
      minLife: 0.16,
      maxLife: 0.3,
    });
  }

  function spawnTargetHit(x, y) {
    spawnParticles(x, y, 0xef4444, 18, {
      minSpeed: 120,
      maxSpeed: 360,
      minSize: 2,
      maxSize: 6,
      gravity: 650,
      minLife: 0.45,
      maxLife: 1.05,
    });
    spawnParticles(x, y, 0xfbbf24, 8, {
      minSpeed: 90,
      maxSpeed: 260,
      minSize: 1.5,
      maxSize: 4,
      gravity: 500,
      minLife: 0.35,
      maxLife: 0.75,
    });
  }

  function spawnGroundHit(x, y) {
    spawnParticles(x, y, 0xef4444, 13, {
      minSpeed: 80,
      maxSpeed: 260,
      minSize: 2,
      maxSize: 5,
      gravity: 700,
      minLife: 0.3,
      maxLife: 0.75,
      upBias: 90,
    });
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
    spawnMuzzleFlash(muzzle, angle);
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
    let message = '¡ROCE! +50';
    let color = COLORS.cyan;

    if (ratio <= 0.35) {
      points = 150;
      message = '¡CENTRO! +150';
      color = COLORS.gold;
    } else if (ratio <= 0.7) {
      points = 100;
      message = '¡DIANA! +100';
      color = COLORS.success;
    }

    state.score += points;
    state.targetFlash = 1;
    state.targetPulse = 1;
    state.targetRespawnAt = currentTime() + TARGET.respawnDelay;

    spawnTargetHit(hitPoint.x, hitPoint.y);
    showMessage(message, color);
    queueProjectileRemoval(actor);
  }

  function handleGroundHit(actor) {
    const x = clamp(actor.body.position.x, 20, DESIGN.width - 20);
    const y = Math.min(actor.body.position.y, GROUND_Y - 3);
    spawnGroundHit(x, y);
    queueProjectileRemoval(actor);

    const now = currentTime();
    if (now >= state.nextMissMessage && state.messageTime <= 0.15) {
      showMessage('¡FALLO!', COLORS.danger);
      state.nextMissMessage = now + 900;
    }
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

  function updateParticles(deltaSeconds) {
    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const particle = state.particles[i];
      particle.life -= deltaSeconds;

      if (particle.life <= 0) {
        if (particle.graphics.parent) {
          particle.graphics.parent.removeChild(particle.graphics);
        }
        particle.graphics.destroy();
        state.particles.splice(i, 1);
        continue;
      }

      particle.vy += particle.gravity * deltaSeconds;
      particle.graphics.x += particle.vx * deltaSeconds;
      particle.graphics.y += particle.vy * deltaSeconds;
      particle.graphics.alpha = clamp(particle.life / particle.maxLife, 0, 1);
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
    targetGlow.alpha = 0.78 + Math.sin(state.elapsed * 3.2) * 0.18 + state.targetPulse * 0.4;
  }

  function updateMessage(deltaSeconds) {
    if (!ui.message || state.messageTime <= 0) return;

    state.messageTime -= deltaSeconds;
    const remaining = Math.max(0, state.messageTime);

    ui.message.alpha = Math.min(1, remaining / 0.4);
    ui.message.y = 176 - (1.75 - remaining) * 17;
    ui.message.scale.set(1 + Math.max(0, remaining - 1.35) * 0.1);
  }

  function updateAimIndicator() {
    if (!aimGraphics) return;
    aimGraphics.clear();
    if (!state.ready) return;

    const muzzle = getMuzzleWorld();
    const angle = getBoreAngle();
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const lineLength = 150;
    const dashLength = 11;
    const gapLength = 8;

    for (let offset = 0; offset < lineLength; offset += dashLength + gapLength) {
      const end = Math.min(offset + dashLength, lineLength);
      aimGraphics
        .moveTo(muzzle.x + cos * offset, muzzle.y + sin * offset)
        .lineTo(muzzle.x + cos * end, muzzle.y + sin * end)
        .stroke({ width: 3, color: COLORS.white, alpha: 0.34 });
    }

    const arrowX = muzzle.x + cos * lineLength;
    const arrowY = muzzle.y + sin * lineLength;
    const wing = 10;
    aimGraphics
      .moveTo(arrowX, arrowY)
      .lineTo(arrowX - cos * wing - sin * wing * 0.65, arrowY - sin * wing + cos * wing * 0.65)
      .stroke({ width: 2.5, color: COLORS.gold, alpha: 0.85 });
    aimGraphics
      .moveTo(arrowX, arrowY)
      .lineTo(arrowX - cos * wing + sin * wing * 0.65, arrowY - sin * wing - cos * wing * 0.65)
      .stroke({ width: 2.5, color: COLORS.gold, alpha: 0.85 });

    const vx = cos * PROJECTILE.speed;
    const vy = sin * PROJECTILE.speed;
    for (let tick = 8; tick <= 48; tick += 8) {
      const x = muzzle.x + vx * tick;
      const y = muzzle.y + vy * tick + 0.5 * GRAVITY_PER_STEP * tick * tick;
      if (x < 0 || x > DESIGN.width || y > GROUND_Y || y < 0) break;
      aimGraphics.circle(x, y, 1.9).fill({
        color: COLORS.white,
        alpha: 0.2,
      });
    }

    if (state.pointerActive) {
      const { x, y } = state.pointer;
      aimGraphics.circle(x, y, 15).stroke({
        width: 2,
        color: COLORS.cyan,
        alpha: 0.92,
      });
      aimGraphics.moveTo(x - 23, y).lineTo(x - 8, y).stroke({
        width: 2,
        color: COLORS.cyan,
        alpha: 0.82,
      });
      aimGraphics.moveTo(x + 8, y).lineTo(x + 23, y).stroke({
        width: 2,
        color: COLORS.cyan,
        alpha: 0.82,
      });
      aimGraphics.moveTo(x, y - 23).lineTo(x, y - 8).stroke({
        width: 2,
        color: COLORS.cyan,
        alpha: 0.82,
      });
      aimGraphics.moveTo(x, y + 8).lineTo(x, y + 23).stroke({
        width: 2,
        color: COLORS.cyan,
        alpha: 0.82,
      });
      aimGraphics.circle(x, y, 2.6).fill({ color: COLORS.cyan, alpha: 1 });
    }
  }

  function updateVisuals(deltaSeconds) {
    state.elapsed += deltaSeconds;

    updateProjectiles(deltaSeconds);
    updateParticles(deltaSeconds);
    updateTarget(deltaSeconds);
    updateMessage(deltaSeconds);
    updateAimIndicator();
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

    const onPointerLeave = () => {
      if (state.pointerActive) {
        state.pointerActive = false;
      }
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
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);

    pointerHandlers = {
      onPointerMove,
      onPointerDown,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
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

    for (const particle of state.particles) {
      if (particle.graphics.parent) {
        particle.graphics.parent.removeChild(particle.graphics);
      }
      particle.graphics.destroy();
    }
    state.particles.length = 0;

    state.score = 0;
    state.shots = 0;
    state.acc = 0;
    state.cooldownUntil = 0;
    state.targetRespawnAt = 0;
    state.targetMove = null;
    state.targetFlash = 0;
    state.targetPulse = 0;
    state.messageTime = 0;
    state.nextMissMessage = 0;

    if (ui.message) ui.message.alpha = 0;
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
    showMessage('¡NUEVA PARTIDA!', COLORS.cyan);
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
        backgroundColor: 0x050b14,
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
      createBackground();
      createGround();
      createTarget();
      createCannon();
      createForegroundMound();

      projectileLayer = new PIXI.Container();
      scene.addChild(projectileLayer);

      particleLayer = new PIXI.Container();
      scene.addChild(particleLayer);

      createAimIndicator();
      createUI();

      bindInput();
      updateUI();
      setElevation(CANNON.defaultElevation);

      tickHandler = tick;
      app.ticker.add(tickHandler);

      state.ready = true;
      document.body.dataset.tomatoGame = 'ready';
      exposeDebugApi();
      showMessage('¡APUNTA Y DISPARA!', COLORS.cyan);

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
