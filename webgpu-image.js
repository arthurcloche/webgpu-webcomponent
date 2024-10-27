class WebGPUImage extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    // Create the canvas in the constructor
    this.canvas = document.createElement("canvas");
    this.shadowRoot.appendChild(this.canvas);

    // Set canvas to behave like an img
    this.style.display = "inline-block";
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "auto";
  }

  static get observedAttributes() {
    return ["src"];
  }

  async connectedCallback() {
    if (this.hasAttribute("src")) {
      await this.initWebGPU();
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "src" && oldValue !== newValue) {
      this.initWebGPU();
    }
  }

  async initWebGPU() {
    const imgSrc = this.getAttribute("src");
    if (!imgSrc) return;

    this.img = await this.loadImage(imgSrc);
    this.textureWidth = this.img.width;
    this.textureHeight = this.img.height;

    // Set canvas size to match image size
    this.canvas.width = this.textureWidth;
    this.canvas.height = this.textureHeight;

    // Initialize WebGPU
    await this.initializeWebGPU(imgSrc);

    // Start rendering
    this.startTime = performance.now();
    this.render();
  }

  async loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async initializeWebGPU(imgSrc) {
    // Check if WebGPU is supported
    if (!navigator.gpu) {
      console.error("WebGPU is not supported in this browser.");
      return;
    }

    this.context = this.canvas.getContext("webgpu");
    if (!this.context) {
      console.error("Failed to get WebGPU context");
      return;
    }

    this.device = await this.initDevice();
    // Remove this line as we've already loaded the image in initWebGPU
    // this.img = await this.loadImage(imgSrc);
    // this.textureWidth and this.textureHeight are already set in initWebGPU

    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.canvasFormat,
      alphaMode: "premultiplied",
    });

    const { texture, sampler } = this.createTextureAndSampler();
    this.uniformBuffer = this.device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const { bindGroupLayout, bindGroup } = this.createBindGroup(
      sampler,
      texture
    );
    this.bindGroup = bindGroup;
    this.pipeline = this.createRenderPipeline(bindGroupLayout);
  }

  async initDevice() {
    if (!navigator.gpu) throw new Error("WebGPU not supported");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No adapter found");
    return await adapter.requestDevice();
  }

  createTextureAndSampler() {
    const texture = this.device.createTexture({
      size: [this.img.width, this.img.height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: this.img },
      { texture },
      [this.img.width, this.img.height]
    );
    const sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
    return { texture, sampler };
  }

  createBindGroup(sampler, texture) {
    const bindGroupLayout = this.device.createBindGroupLayout({
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
    const bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: texture.createView() },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
    return { bindGroupLayout, bindGroup };
  }

  createRenderPipeline(bindGroupLayout) {
    const shaderModule = this.device.createShaderModule({
      code: this.shaderCode,
    });
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
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
        targets: [{ format: this.canvasFormat }],
      },
      primitive: { topology: "triangle-strip" },
    });
  }

  updateUniformBuffer(time) {
    const uniformData = new Float32Array(12);
    uniformData.set([1, 1, 1, 1, time]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
  }

  render() {
    // Update uniform buffer
    this.updateUniformBuffer((performance.now() - this.startTime) / 1000);

    // Encode and submit commands
    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.draw(4, 1, 0, 0);
    passEncoder.end();
    this.device.queue.submit([commandEncoder.finish()]);

    requestAnimationFrame(() => this.render());
  }

  shaderCode = `
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
      @location(0) uv: vec2f,
    }

    @vertex
    fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
      var pos = array<vec2f, 4>(
        vec2f(-1.0, -1.0),
        vec2f(1.0, -1.0),
        vec2f(-1.0, 1.0),
        vec2f(1.0, 1.0)
      );
      var uv = array<vec2f, 4>(
        vec2f(0.0, 1.0),
        vec2f(1.0, 1.0),
        vec2f(0.0, 0.0),
        vec2f(1.0, 0.0)
      );
      var output: VertexOutput;
      output.position = vec4f(pos[vertexIndex], 0.0, 1.0);
      output.uv = uv[vertexIndex];
      return output;
    }
    
    fn palette(t: f32) -> vec3<f32> {
        let a = vec3<f32>(0.8, 0.8, 0.9);
        let b = vec3<f32>(0.2, 0.1, 0.1);
        let c = vec3<f32>(1.0, 1.0, 1.0);
        let d = vec3<f32>(0.0 + 0.18 * cos(0.1 * uniforms.time), 0.33 + 0.18 * sin(0.2 * uniforms.time), 0.67);
        return a + b * cos(6.28318530718 * (c * t + d));
    }

    fn luminance(color: vec3<f32>) -> f32 {
      return dot(color, vec3<f32>(0.299, 0.587, 0.114));
    }

    fn offset(uv: vec2f) -> vec2f {
      let amplitude = 0.025;
      let frequency = 10.0;
      let phase = uniforms.time * 10.0;
      return (uv + vec2f(amplitude * sin(frequency * uv.x + phase) * 0., amplitude * sin(frequency * uv.x + phase)));
    }

    @fragment
    fn fragmentMain(@location(0) uv: vec2f) -> @location(0) vec4f {
      let offsetUV = offset(uv);
      let texColor = textureSample(tex, texSampler, offsetUV);
      let luminance = 1.-luminance(texColor.rgb);
      let len = length(uv);
      let tint = vec4f(
        palette(uniforms.time * .5 + luminance).r,
        palette(uniforms.time * .5 + uv.y ).g,
        palette(uniforms.time * .5 + uv.x ).b,
        1.0
      ) * 2.;
      return clamp(texColor * tint, vec4f(0.0), vec4f(1.0));
    }
  `;
}

customElements.define("webgpu-image", WebGPUImage);
