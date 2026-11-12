// The 1280x720 test picture the projector shows: a grid and circle to reveal
// distortion, coloured corners to reveal flips, and text and 1px lines to
// reveal lost resolution.
export function drawPattern() {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 1280, 720);

  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let x = 80; x < 1280; x += 80) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 720);
  }
  for (let y = 80; y < 720; y += 80) {
    ctx.moveTo(0, y);
    ctx.lineTo(1280, y);
  }
  ctx.moveTo(920, 360);
  ctx.arc(640, 360, 280, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 1272, 712);

  ctx.font = "bold 32px sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (const [text, colour, x, y] of [
    ["TL", "#e33", 8, 8],
    ["TR", "#2a2", 1192, 8],
    ["BL", "#36f", 8, 632],
    ["BR", "#fa0", 1192, 632],
  ]) {
    ctx.fillStyle = colour;
    ctx.fillRect(x, y, 80, 80);
    ctx.fillStyle = "#000";
    ctx.fillText(text, x + 40, y + 40);
  }

  ctx.fillStyle = "#fff";
  ctx.fillRect(250, 170, 620, 220);
  ctx.fillStyle = "#000";
  ctx.textAlign = "left";
  let y = 200;
  for (const size of [48, 32, 24, 16, 12]) {
    ctx.font = `${size}px sans-serif`;
    ctx.fillText(`${size}px Preheat the oven to 400°F`, 262, y);
    y += size + 16;
  }

  ctx.fillStyle = "#fff";
  ctx.fillRect(250, 410, 180, 100);
  ctx.fillStyle = "#000";
  for (let i = 0; i < 80; i += 2) {
    ctx.fillRect(262 + i, 420, 1, 80);
    ctx.fillRect(350, 420 + i, 70, 1);
  }

  return canvas;
}
