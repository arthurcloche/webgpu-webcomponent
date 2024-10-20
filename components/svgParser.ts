const container = document.getElementById('ref');
console.log(container)
const SVG_NS = 'http://www.w3.org/2000/svg';

// Global variables
let svgElement: SVGSVGElement;
let currentElement: SVGElement | null = null;

interface SVGElementState {
  id: string;
  type: 'circle' | 'rect';
  attributes: Record<string, string | number>;
}

class SVGParser {
  private svgElement: SVGSVGElement;
  private elementStates: Map<string, SVGElementState> = new Map();

  constructor(svgElement: SVGSVGElement) {
    this.svgElement = svgElement;
  }

  createElement(state: SVGElementState): void {
    let element = this.svgElement.getElementById(state.id);
    if (!element) {
      element = document.createElementNS(SVG_NS, state.type);
      element.id = state.id;
      this.svgElement.appendChild(element);
    }
    this.updateElement(state);
  }

  updateElement(state: SVGElementState): void {
    const element = this.svgElement.getElementById(state.id);
    if (element) {
      for (const [attr, value] of Object.entries(state.attributes)) {
        element.setAttribute(attr, value.toString());
      }
    }
    this.elementStates.set(state.id, state);
  }

  removeElement(id: string): void {
    const element = this.svgElement.getElementById(id);
    if (element) {
      this.svgElement.removeChild(element);
      this.elementStates.delete(id);
    }
  }
}

function createCanvas(width: number, height: number): void {
  if (!container) {
    throw new Error('Container element not found');
  }

  if (width && height) {
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
  } else {
    const containerRect = container.getBoundingClientRect();
    width = width || containerRect.width;
    height = height || containerRect.height;

    if (width === 0 || height === 0) {
      throw new Error('Container or specified dimensions have zero width or height');
    }
  }
  svgElement = document.createElementNS(SVG_NS, 'svg');
  svgElement.setAttribute('width', width.toString());
  svgElement.setAttribute('height', height.toString());
  svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
  container?.appendChild(svgElement);
}

// Example usage
createCanvas(300, 300);
let parser: SVGParser;
let time = 0;

function animate() {
  if (!parser) {
    parser = new SVGParser(svgElement);
  }
  

  // Clear the previous elements
  svgElement.innerHTML = '';
  
  // Calculate the y position using a sine wave for the circle
  const circleY = 150 + Math.sin(time) * 20;
  
  // Draw the circle at the new position
  parser.createElement({
    id: 'mainCircle',
    type: 'circle',
    attributes: { cx: 150, cy: circleY, r: 100, fill: 'black' }
  });
  
  // Calculate the position for the square
  const squareX = 150 + Math.cos(time) * 50;
  const squareY = circleY - 60 + Math.sin(time * 2) * 10;
  
  // Draw the small blue square
  parser.createElement({
    id: 'mainSquare',
    type: 'rect',
    attributes: { x: squareX - 10, y: squareY - 10, width: 20, height: 20, fill: 'blue' }
  });
  
  // Increment time
  time += 0.05;
  
  // Request the next animation frame
  requestAnimationFrame(animate);
}

// Start the animation
animate();
