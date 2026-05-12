const text = "GAME DEVELOPER";

let index = 0;

function typeText(){

  document.getElementById("typing").innerHTML =
  text.slice(0,index);

  index++;

  if(index <= text.length){
    setTimeout(typeText,120);
  }

}

typeText();
