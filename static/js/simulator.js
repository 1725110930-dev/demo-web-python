// simulation.js

// Variables globales para los motores
let app, engine, world;

// Arreglo para sincronizar masivamente { cuerpoFisico, graficoVisual }
const actores = []; 

async function setup() {
  console.log("Inicializando simulación...");

  // --- 1. CONFIGURACIÓN DE PIXIJS (Cerebro Visual) ---
  app = new PIXI.Application();
  await app.init({ 
    width: 800, 
    height: 600, 
    backgroundColor: 0x1e293b, // Color de fondo gris azulado
    antialias: true 
  });
  // Añadimos el lienzo canvas al cuerpo de la página
  document.body.appendChild(app.canvas);

  // --- 2. CONFIGURACIÓN DE MATTER.JS (Cerebro Físico) ---
  const { Engine, Bodies, Composite } = Matter;
  engine = Engine.create();
  world = engine.world;

  // --- 3. CREACIÓN DE OBJETOS (Suelo y Caja) ---

  // A. SUELO ESTÁTICO (Base gris)
  const sueloFisico = Bodies.rectangle(400, 570, 800, 40, { isStatic: true });
  const sueloGrafico = new PIXI.Graphics();
  sueloGrafico.rect(0, 0, 800, 40);
  sueloGrafico.fill({ color: 0x475569 }); // Sintaxis v8 requerida
  sueloGrafico.pivot.set(400, 20); // Centramos el pivote (Matter mide desde el centro)
  
  // Añadimos cada pieza a su respectivo motor
  app.stage.addChild(sueloGrafico);
  Composite.add(world, sueloFisico);
  // Guardamos el par en el arreglo de sincronización
  actores.push({ cuerpo: sueloFisico, grafico: sueloGrafico });

  // B. CAJA DINÁMICA (Caja azul que cae)
  const cajaFisica = Bodies.rectangle(400, 100, 60, 60, { restitution: 0.6 });
  const cajaGrafica = new PIXI.Graphics();
  cajaGrafica.rect(0, 0, 60, 60);
  cajaGrafica.fill({ color: 0x38bdf8 }); // Color cyan brillante
  cajaGrafica.pivot.set(30, 30); // Pivote centrado (mitad de 60x60)
  
  app.stage.addChild(cajaGrafica);
  Composite.add(world, cajaFisica);
  actores.push({ cuerpo: cajaFisica, grafico: cajaGrafica });

  // --- 4. BUCLE DE ANIMACIÓN Y ACTUALIZACIÓN (60 FPS) ---
  app.ticker.add((ticker) => {
    // Avanzar el tiempo matemático en el motor de físicas
    Engine.update(engine, ticker.deltaTime * (1000 / 60));

    // Iteración masiva para clonar las posiciones matemáticas a los píxeles
    actores.forEach(actor => {
      actor.grafico.x = actor.cuerpo.position.x;
      actor.grafico.y = actor.cuerpo.position.y;
      actor.grafico.rotation = actor.cuerpo.angle; // Copia la rotación exacta
    });
  });

  console.log("¡Simulación unificada corriendo con éxito!");
}

// 5. DISPARADOR DE SEGURIDAD
// Esperamos el evento 'load' para garantizar que las dos librerías externas estén inyectadas
window.addEventListener('load', () => {
  if (typeof PIXI !== 'undefined' && typeof Matter !== 'undefined') {
    setup();
  } else {
    console.error("Error crítico: No se pudieron mapear las variables globales PIXI o Matter.");
  }
});
