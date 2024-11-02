class ImageTexture {
  constructor(device, imageBitmap) {
    this.device = device;
    this.texture = device.createTexture({
      size: [imageBitmap.width, imageBitmap.height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: imageBitmap },
      { texture: this.texture },
      [imageBitmap.width, imageBitmap.height]
    );
  }
}

class GradientMask {
  constructor(device, format, width, height) {
    this.device = device;
    this.width = width;
    this.height = height;
    this.aspect = width / height;
    this.format = format;
    this.texture = this.createTexture();
    this.bindGroupLayout = this.createBindGroupLayout();
    this.uniformBuffer = this.createUniformBuffer();
    this.bindGroup = this.createBindGroup();
    this.pipeline = this.createPipeline();
  }

  createTexture() {
    return this.device.createTexture({
      size: [this.width, this.height],
      format: this.format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  createBindGroupLayout() {
    return this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
  }

  createUniformBuffer() {
    return this.device.createBuffer({
      size: 6 * 4, // 6 floats (center.x, center.y, radius, softness, aspect, padding)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  createBindGroup() {
    return this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer },
        },
      ],
    });
  }

  createPipeline() {
    const shaderModule = this.device.createShaderModule({
      code: `
            struct Uniforms {
                center: vec2<f32>,
                radius: f32,
                softness: f32,
                aspect: f32,
                padding: f32,
            }

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;

            @vertex
            fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
                var pos = array<vec2<f32>, 4>(
                    vec2<f32>(-1.0, -1.0),
                    vec2<f32>(1.0, -1.0),
                    vec2<f32>(-1.0, 1.0),
                    vec2<f32>(1.0, 1.0)
                );
                return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
            }

            @fragment
            fn fragmentMain(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
                let uv = pos.xy / vec2<f32>(${this.width}.0, ${this.height}.0);
                let aspectCorrectedUV = (uv - 0.5) * vec2<f32>(uniforms.aspect, 1.0) + 0.5;
                let dist = distance(aspectCorrectedUV, uniforms.center);
                let alpha = 1.0 - smoothstep(uniforms.radius - uniforms.softness, uniforms.radius, dist);
                return vec4<f32>(1.0, 1.0, 1.0, alpha);
            }
        `,
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });

    return this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: this.format }],
      },
      primitive: {
        topology: "triangle-strip",
        stripIndexFormat: "uint32",
      },
    });
  }

  render(encoder) {
    const passEncoder = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.texture.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });

    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.draw(4);
    passEncoder.end();
  }

  updateUniforms(center, radius, softness) {
    const uniformData = new Float32Array([
      ...center,
      radius,
      softness,
      this.aspect,
      0,
    ]); // Added padding
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
  }
}

class MainRenderer {
  constructor(device, canvas, imageBitmap) {
    this.device = device;
    this.canvas = canvas;
    this.context = canvas.getContext("webgpu");
    this.format = navigator.gpu.getPreferredCanvasFormat();

    // Configure the WebGPU context
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "premultiplied",
    });

    this.imageTexture = new ImageTexture(device, imageBitmap);
    this.gradientMask = new GradientMask(
      device,
      this.format,
      canvas.width,
      canvas.height
    );
    this.pipeline = this.createPipeline();
    this.bindGroup = this.createBindGroup();
  }

  createPipeline() {
    const shaderModule = this.device.createShaderModule({
      code: `
                struct VertexOutput {
                    @builtin(position) position: vec4<f32>,
                    @location(0) uv: vec2<f32>,
                }

                @vertex
                fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
                    var pos = array<vec2<f32>, 4>(
                        vec2<f32>(-1.0, -1.0),
                        vec2<f32>(1.0, -1.0),
                        vec2<f32>(-1.0, 1.0),
                        vec2<f32>(1.0, 1.0)
                    );
                    var uv = array<vec2<f32>, 4>(
                        vec2<f32>(0.0, 1.0),
                        vec2<f32>(1.0, 1.0),
                        vec2<f32>(0.0, 0.0),
                        vec2<f32>(1.0, 0.0)
                    );
                    var output: VertexOutput;
                    output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
                    output.uv = uv[vertexIndex];
                    return output;
                }

                @group(0) @binding(0) var imageSampler: sampler;
                @group(0) @binding(1) var imageTexture: texture_2d<f32>;
                @group(0) @binding(2) var maskTexture: texture_2d<f32>;

                @fragment
                fn fragmentMain(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
                    let imageColor = textureSample(imageTexture, imageSampler, uv);
                    let mask = textureSample(maskTexture, imageSampler, uv).a;
                    return mix(imageColor, vec4<f32>(1.0, 0.0, 0.0, 1.0), mask);
                }
            `,
    });

    return this.device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: shaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: this.format }],
      },
      primitive: {
        topology: "triangle-strip",
        stripIndexFormat: "uint32",
      },
    });
  }

  createBindGroup() {
    return this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: this.device.createSampler({
            magFilter: "linear",
            minFilter: "linear",
          }),
        },
        {
          binding: 1,
          resource: this.imageTexture.texture.createView(),
        },
        {
          binding: 2,
          resource: this.gradientMask.texture.createView(),
        },
      ],
    });
  }

  render() {
    const commandEncoder = this.device.createCommandEncoder();

    // Render gradient mask
    this.gradientMask.render(commandEncoder);

    // Main render pass
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });

    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.draw(4);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }
}

async function loadImage(src) {
  const img = new Image();
  img.crossOrigin = "anonymous"; // This line is crucial
  img.src = src;
  await img.decode();
  return createImageBitmap(img);
}

async function initWebGPU() {
  if (!navigator.gpu) throw new Error("WebGPU not supported");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Couldn't request WebGPU adapter");
  const device = await adapter.requestDevice();
  return device;
}

async function main() {
  try {
    const canvas = document.querySelector("canvas");
    const device = await initWebGPU();

    const imageBitmap = await loadImage(
      "https://cdn.shopify.com/s/files/1/0817/9308/9592/files/crystal.png?v=1722451245"
    );

    // Set canvas size to match the image
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;

    // Adjust CSS to maintain aspect ratio and fit in viewport
    canvas.style.maxWidth = "100%";
    canvas.style.maxHeight = "100vh";
    canvas.style.width = "auto";
    canvas.style.height = "auto";
    canvas.style.display = "block";
    canvas.style.margin = "auto";

    const renderer = new MainRenderer(device, canvas, imageBitmap);

    function frame() {
      renderer.gradientMask.updateUniforms([0.5, 0.5], 0.3, 0.1);
      renderer.render();
      requestAnimationFrame(frame);
    }

    frame();
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

main();

window.addEventListener("resize", () => {
  const canvas = document.querySelector("canvas");
  canvas.width = canvas.clientWidth * window.devicePixelRatio;
  canvas.height = canvas.clientHeight * window.devicePixelRatio;
  // You might need to update your renderer here as well
});
