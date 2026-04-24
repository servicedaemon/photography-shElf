// Pixel elf — vanilla JS + SVG port from PixelElf.tsx
// Recolored for Shelf: gold ears, dark blue face, black eyes

const PIXEL = {
  M: '#d4a843', // gold — ears
  L: '#3d6a9e', // dark blue — face
  B: '#0c0c0c', // black — eyes
  G: '#4ade80', // green — accents
  S: '#d4a843', // gold — sparkles
};

const GRIDS = {
  idle: ['M.....M', 'MLLLLLM', '.LLLLL.', 'LLBLBLL', 'LLLLLLL', '.LLLLL.'],
  reading: ['M.....M', 'MLLLLLM', '.LLLLL.', 'LLLLLLL', 'LLBLBLL', '.LLLLL.'],
  sleeping: ['M.....M', 'MLLLLLM', '.LLLLL.', 'LLLLLLL', 'LLLLLLL', '.LLLLL.'],
  scribbling_1: ['M.....M', 'MLLLLLM', '.LLLLL.', 'LLBLBLL', 'LLLLLLL', '.LLLLL.'],
  scribbling_2: ['M.....M', 'MLLLLLM', '.LLLLL.', 'LLBLBLL', 'LLLLLLL', '.LLLLL.'],
  peeking: ['M.....M', 'MLLLLLM', '.LLLLL.', 'LLBLBLL'],
  waving: ['M.....M', 'MLLLLLM', '.LLLLL.', 'LLBLLLL', 'LLLLLLL', '.LLLLL.'],
};

function buildSvgRects(grid, ps) {
  let rects = '';
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch !== '.' && PIXEL[ch]) {
        rects += `<rect x="${x * ps}" y="${y * ps}" width="${ps}" height="${ps}" fill="${PIXEL[ch]}"/>`;
      }
    }
  }
  return rects;
}

export function createElf(container, pose = 'idle', pixelSize = 4) {
  const ps = pixelSize;
  let frame = 0;
  let interval = null;
  let currentPose = pose;

  function render() {
    let gridKey;
    if (currentPose === 'scribbling') {
      gridKey = frame === 0 ? 'scribbling_1' : 'scribbling_2';
    } else if (currentPose === 'confused' || currentPose === 'sparkle') {
      gridKey = 'idle';
    } else {
      gridKey = currentPose;
    }

    const grid = GRIDS[gridKey] || GRIDS.idle;
    const cols = 7;
    const rows = grid.length;

    const extraAbove = currentPose === 'confused' ? 3 : currentPose === 'sleeping' ? 2 : 0;
    const extraRight = currentPose === 'scribbling' ? 2 : currentPose === 'waving' ? 2 : 0;
    const totalWidth = (cols + extraRight) * ps;
    const totalHeight = (rows + extraAbove) * ps;

    let decorators = '';

    // Confused: green ? above ears
    if (currentPose === 'confused') {
      decorators += `<rect x="${2 * ps}" y="0" width="${ps}" height="${ps}" fill="${PIXEL.G}"/>`;
      decorators += `<rect x="${3 * ps}" y="0" width="${ps}" height="${ps}" fill="${PIXEL.G}"/>`;
      decorators += `<rect x="${3 * ps}" y="${ps}" width="${ps}" height="${ps}" fill="${PIXEL.G}"/>`;
    }

    // Sleeping: floating zzz
    if (currentPose === 'sleeping') {
      decorators += `<rect x="${5 * ps}" y="0" width="${ps}" height="${ps}" fill="${PIXEL.S}" opacity="0.5"/>`;
      decorators += `<rect x="${5.5 * ps}" y="${0.8 * ps}" width="${ps * 0.7}" height="${ps * 0.7}" fill="${PIXEL.S}" opacity="0.3"/>`;
    }

    // Scribbling: animated quill
    if (currentPose === 'scribbling') {
      const qy = frame === 0 ? 2 : 3;
      const qy2 = frame === 0 ? 3 : 4;
      decorators += `<rect x="${7.5 * ps}" y="${(qy + extraAbove) * ps}" width="${ps * 0.8}" height="${ps * 0.8}" fill="${PIXEL.G}"/>`;
      decorators += `<rect x="${7.5 * ps}" y="${(qy2 + extraAbove) * ps}" width="${ps * 0.6}" height="${ps * 0.6}" fill="${PIXEL.G}" opacity="0.5"/>`;
    }

    // Waving: tiny hand
    if (currentPose === 'waving') {
      decorators += `<rect x="${7.5 * ps}" y="${(1 + extraAbove) * ps}" width="${ps}" height="${ps}" fill="${PIXEL.L}"/>`;
      decorators += `<rect x="${7.5 * ps}" y="${(2 + extraAbove) * ps}" width="${ps}" height="${ps}" fill="${PIXEL.L}"/>`;
    }

    // Sparkle: blinking dots
    if (currentPose === 'sparkle') {
      const opacity = frame === 0 ? 1 : 0.25;
      decorators += `<g opacity="${opacity}">`;
      decorators += `<rect x="0" y="0" width="${ps}" height="${ps}" fill="${PIXEL.S}"/>`;
      decorators += `<rect x="${6 * ps}" y="0" width="${ps}" height="${ps}" fill="${PIXEL.S}"/>`;
      decorators += `<rect x="0" y="${5 * ps}" width="${ps}" height="${ps}" fill="${PIXEL.G}" opacity="0.6"/>`;
      decorators += `<rect x="${6 * ps}" y="${6 * ps}" width="${ps}" height="${ps}" fill="${PIXEL.G}" opacity="0.6"/>`;
      decorators += `</g>`;
    }

    const mainGrid = buildSvgRects(grid, ps);

    container.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" shape-rendering="crispEdges">
        <g transform="translate(0, ${extraAbove * ps})">${mainGrid}</g>
        ${decorators}
      </svg>
    `;
  }

  function setPose(newPose) {
    currentPose = newPose;
    frame = 0;

    if (interval) {
      clearInterval(interval);
      interval = null;
    }

    if (newPose === 'scribbling' || newPose === 'sparkle') {
      const ms = newPose === 'scribbling' ? 400 : 600;
      interval = setInterval(() => {
        frame = (frame + 1) % 2;
        render();
      }, ms);
    }

    render();
  }

  function destroy() {
    if (interval) clearInterval(interval);
    container.innerHTML = '';
  }

  // Easter egg: click to cycle poses
  const poses = [
    'idle',
    'reading',
    'sleeping',
    'scribbling',
    'peeking',
    'waving',
    'confused',
    'sparkle',
  ];
  let poseIndex = poses.indexOf(pose);
  container.addEventListener('click', () => {
    poseIndex = (poseIndex + 1) % poses.length;
    setPose(poses[poseIndex]);
  });
  container.classList.add('elf-container');

  render();
  if (pose === 'scribbling' || pose === 'sparkle') {
    setPose(pose);
  }

  return { setPose, destroy, render };
}
