const canvas = document.querySelector("canvas");
const context = canvas.getContext("webgpu");

let device, canvasFormat, pipeline, bindGroup, vertexBuffer, uniformBuffer;
let textureWidth, textureHeight, startTime;

const shaderCode = `
    struct Uniforms {
        tintColor: vec4f,
        time: f32,
        padding: vec3f,
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

    @fragment
    fn fragmentMain(@location(0) texCoord: vec2f) -> @location(0) vec4f {
        let texColor = textureSample(tex, texSampler, texCoord);
        let animatedTint = vec4f(
            (sin(uniforms.time) + 1.0) / 2.0,
            (cos(uniforms.time) + 1.0) / 2.0,
            (sin(uniforms.time + 3.14) + 1.0) / 2.0,
            1.0
        );
        return texColor * animatedTint;
    }
`;

async function initWebGPU() {
  if (!navigator.gpu) throw new Error("WebGPU not supported");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No adapter found");
  device = await adapter.requestDevice();
  canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
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
  const horizontalMargin = (window.innerWidth - scaledWidth) / 2;
  canvas.style.position = "absolute";
  canvas.style.left = `${horizontalMargin}px`;
  canvas.style.top = "0px";
}

function createVertexBuffer() {
  const vertices = new Float32Array([
    -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0,
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

function createTextureAndSampler(img) {
  const texture = device.createTexture({
    size: [img.width, img.height],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: img }, { texture }, [
    img.width,
    img.height,
  ]);
  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });
  return { texture, sampler };
}

function createBindGroup(sampler, texture) {
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

function createRenderPipeline(bindGroupLayout) {
  const shaderModule = device.createShaderModule({ code: shaderCode });
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

function updateUniformBuffer(time) {
  const uniformData = new Float32Array(12);
  uniformData.set([1, 1, 1, 1, time]);
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);
}

function render() {
  resizeCanvas();
  updateUniformBuffer((performance.now() - startTime) / 1000);
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
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function main() {
  const img = await loadImage(
    "https://cdn.shopify.com/s/files/1/0817/9308/9592/files/crystal.png?v=1722451245"
  );
  textureWidth = img.width;
  textureHeight = img.height;
  await initWebGPU();
  vertexBuffer = createVertexBuffer();
  const { texture, sampler } = createTextureAndSampler(img);
  uniformBuffer = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const { bindGroupLayout, bindGroup: bg } = createBindGroup(sampler, texture);
  bindGroup = bg;
  pipeline = createRenderPipeline(bindGroupLayout);
  startTime = performance.now();
  requestAnimationFrame(render);
  window.addEventListener("resize", resizeCanvas);
}

main();
