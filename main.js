// Get the canvas and its context
const canvas = document.querySelector("canvas");
const context = canvas.getContext("webgpu");

let device, canvasFormat, pipeline, bindGroup, vertexBuffer;
let textureWidth, textureHeight;

// Create shader code
const shaderCode = `
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

    @group(0) @binding(0) var texSampler: sampler;
    @group(0) @binding(1) var tex: texture_2d<f32>;
    @group(0) @binding(2) var<uniform> tintColor: vec4f;

    @fragment
    fn fragmentMain(@location(0) texCoord: vec2f) -> @location(0) vec4f {
        let texColor = textureSample(tex, texSampler, texCoord);
        // Mix the texture color with the tint color
        return texColor * tintColor;
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
  const devicePixelRatio = window.devicePixelRatio || 1;
  canvas.width = textureWidth * devicePixelRatio;
  canvas.height = textureHeight * devicePixelRatio;
  canvas.style.width = `${textureWidth}px`;
  canvas.style.height = `${textureHeight}px`;
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

  // Create uniform buffer for tint color (RGBA)
  const uniformBuffer = device.createBuffer({
    size: 16, // 4 floats * 4 bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Set tint color (red tint in this example)
  const tintColor = new Float32Array([1.0, 0.0, 0.0, 1.0]); // Red tint
  device.queue.writeBuffer(uniformBuffer, 0, tintColor);

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

  // Initial render
  render();

  // Set up resize handler if needed
  window.addEventListener("resize", render);
}

main();
