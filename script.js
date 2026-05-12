const text =
"BUILDING FUTURISTIC IDEAS";

let index = 0;

function typeText(){

  document.getElementById("typing").innerHTML =
  text.slice(0,index);

  index++;

  if(index <= text.length){
    setTimeout(typeText,80);
  }

}

typeText();



// PARTICLES

const canvas =
document.getElementById("particles");

const ctx =
canvas.getContext("2d");

canvas.width =
window.innerWidth;

canvas.height =
window.innerHeight;

const particles = [];

for(let i = 0; i < 90; i++){

  particles.push({

    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,

    radius: Math.random() * 2 + 1,

    dx: (Math.random() - 0.5) * 0.4,
    dy: (Math.random() - 0.5) * 0.4

  });

}

function animate(){

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  particles.forEach(p => {

    p.x += p.dx;
    p.y += p.dy;

    if(p.x < 0 || p.x > canvas.width){
      p.dx *= -1;
    }

    if(p.y < 0 || p.y > canvas.height){
      p.dy *= -1;
    }

    ctx.beginPath();

    ctx.arc(
      p.x,
      p.y,
      p.radius,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
    "rgba(125,211,252,0.7)";

    ctx.fill();

  });

  requestAnimationFrame(animate);

}

animate();


window.addEventListener("resize",()=>{

  canvas.width =
  window.innerWidth;

  canvas.height =
  window.innerHeight;

});
