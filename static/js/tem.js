// simulation.js

async function setup() {
  // 1. Crear la aplicación de PixiJS
  const app = new PIXI.Application();

  // 2. Inicializar el lienzo con un tamaño y un color de fondo (rojo)
  await app.init({ 
    width: 400, 
    height: 300, 
    backgroundColor: 0xff0000 
  });

  // 3. Pegar el lienzo en tu página web
  document.body.appendChild(app.canvas);
}

// Arrancar el código en cuanto la página esté lista
window.addEventListener('load', setup);
