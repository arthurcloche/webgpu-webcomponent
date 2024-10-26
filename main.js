// Get the canvas and its context
const canvas = document.querySelector("canvas");
const context = canvas.getContext("webgpu");

let device, canvasFormat, pipeline, bindGroup, vertexBuffer;
let textureWidth, textureHeight;
let uniformBuffer; // Add this line

// Create shader code
const shaderCode = `
    struct Uniforms {
        tintColor: vec4f,
        time: f32,
        padding: vec3f, // Add padding to align to 16 bytes
    }

    @group(0) @binding(0) var texSampler: sampler;
    @group(0) @binding(1) var tex: texture_2d<f32>;
    @group(0) @binding(2) var<uniform> uniforms: Uniforms;

    struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) texCoord: vec2f,
    }

    @vertex
    fn vertexMain(@location(0) position: vec2f,
                  @location(1) texCoord: vec2f) -> VertexOutput {
        var output: VertexOutput;
        output.position = vec4f(position, 0.0, 1.0);
        output.texCoord = texCoord;
        return output;
    }
    const twopi = 6.2830;
    @fragment
    
    fn fragmentMain(@location(0) texCoord: vec2f) -> @location(0) vec4f {
        let uv = texCoord;
        let texColor = textureSample(tex, texSampler, uv);
        // Animate the tint color based on time
        let animatedTint = vec4f(
            (sin(uniforms.time + uv.x * twopi) + 1.0) / 2.0,
            (cos(uniforms.time + uv.y * twopi) + 1.0) / 2.0,
            (sin(uniforms.time + uv.x * twopi + 3.14) + 1.0) / 2.0,
            1.0
        );
        return texColor * animatedTint;
    }
`;

async function initWebGPU() {
  if (!navigator.gpu) {
    throw new Error("WebGPU not supported");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("No adapter found");
  }

  device = await adapter.requestDevice();

  canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device: device,
    format: canvasFormat,
    alphaMode: "premultiplied",
  });
}

function resizeCanvas() {
  canvas.width = textureWidth;
  canvas.height = textureHeight;
  const scale = window.innerHeight / textureHeight;
  const scaledWidth = textureWidth * scale;
  const scaledHeight = textureHeight * scale;
  canvas.style.width = `${scaledWidth}px`;
  canvas.style.height = `${scaledHeight}px`;

  //   const horizontalMargin = (window.innerWidth - scaledWidth) / 2;
  //   canvas.style.position = "absolute";
  //   canvas.style.left = `${horizontalMargin}px`;
  //   canvas.style.top = "0px";

  // Log the new dimensions
  //   console.log(`Canvas size: ${canvas.width}x${canvas.height}`);
  //   console.log(`Displayed size: ${canvas.style.width}x${canvas.style.height}`);
  //   console.log(`Left margin: ${canvas.style.left}`);
}

function createVertexBuffer(device) {
  const vertices = new Float32Array([
    -1.0, -1.0, 0.0, 1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 0.0, 0.0, 1.0, 1.0,
    1.0, 0.0,
  ]);

  const buffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });

  new Float32Array(buffer.getMappedRange()).set(vertices);
  buffer.unmap();

  return buffer;
}

function createTextureAndSampler(device, img) {
  const texture = device.createTexture({
    size: [img.width, img.height],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.queue.copyExternalImageToTexture(
    { source: img },
    { texture: texture },
    [img.width, img.height]
  );

  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  return { texture, sampler };
}

function createBindGroup(device, sampler, texture, uniformBuffer) {
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: texture.createView() },
      { binding: 2, resource: { buffer: uniformBuffer } },
    ],
  });

  return { bindGroupLayout, bindGroup };
}

function createRenderPipeline(
  device,
  shaderModule,
  bindGroupLayout,
  canvasFormat
) {
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });

  return device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: "vertexMain",
      buffers: [
        {
          arrayStride: 16,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 8, format: "float32x2" },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fragmentMain",
      targets: [{ format: canvasFormat }],
    },
    primitive: { topology: "triangle-strip" },
  });
}

function render() {
  resizeCanvas();

  const currentTime = (performance.now() - startTime) / 1000; // Convert to seconds
  updateUniformBuffer(device, uniformBuffer, currentTime);

  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });

  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.setVertexBuffer(0, vertexBuffer);
  passEncoder.draw(4, 1, 0, 0);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);

  requestAnimationFrame(render);
}

async function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.src = src;
  });
}

async function main() {
  // Load image first
  const img = await loadImage(
    "https://cdn.shopify.com/s/files/1/0817/9308/9592/files/crystal.png?v=1722451245"
  );

  // Set texture dimensions
  textureWidth = img.width;
  textureHeight = img.height;

  // Initialize WebGPU
  await initWebGPU();

  // Create vertex buffer
  vertexBuffer = createVertexBuffer(device);

  // Create shader module
  const shaderModule = device.createShaderModule({
    code: shaderCode,
  });

  // Create texture and sampler
  const { texture, sampler } = createTextureAndSampler(device, img);

  // Create uniform buffer for tint color (RGBA) and time
  const uniformBufferSize = 48; // Increase to 48 bytes (3 vec4f worth of space)
  uniformBuffer = device.createBuffer({
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Initialize uniform buffer
  const initialUniformData = new Float32Array(12);
  initialUniformData.set([1.0, 1.0, 1.0, 1.0, 0.0]); // Initial white tint and 0 time
  device.queue.writeBuffer(uniformBuffer, 0, initialUniformData);

  // Create bind group layout and bind group
  const { bindGroupLayout, bindGroup: bg } = createBindGroup(
    device,
    sampler,
    texture,
    uniformBuffer
  );
  bindGroup = bg;

  // Create pipeline layout and render pipeline
  pipeline = createRenderPipeline(
    device,
    shaderModule,
    bindGroupLayout,
    canvasFormat
  );

  // Start the render loop
  startTime = performance.now();
  requestAnimationFrame(render);
}
// Set up resize handler
window.addEventListener("resize", () => {
  resizeCanvas();
});
main();

function updateUniformBuffer(device, uniformBuffer, time) {
  const uniformData = new Float32Array(12); // 12 floats total
  uniformData[0] = 1.0; // R
  uniformData[1] = 1.0; // G
  uniformData[2] = 1.0; // B
  uniformData[3] = 1.0; // A
  uniformData[4] = time;
  // uniformData[5] to [11] are implicitly 0 (padding)
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);
}
