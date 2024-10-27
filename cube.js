import { mat4 } from "https://cdn.skypack.dev/gl-matrix";

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
  }

  async initialize() {
    if (!navigator.gpu) {
      throw new Error("WebGPU not supported on this browser.");
    }

    this.adapter = await navigator.gpu.requestAdapter();
    this.device = await this.adapter.requestDevice();

    this.context = this.canvas.getContext("webgpu");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
    });

    this.createPipeline();
  }

  createPipeline() {
    const shaderModule = this.device.createShaderModule({
      code: `
                struct Uniforms {
                    modelViewProjectionMatrix : mat4x4<f32>,
                    normalMatrix : mat4x4<f32>,
                }

                @binding(0) @group(0) var<uniform> uniforms : Uniforms;

                struct VertexOutput {
                    @builtin(position) Position : vec4<f32>,
                    @location(0) fragNormal : vec3<f32>,
                }

                @vertex
                fn vertexMain(@location(0) position: vec3<f32>,
                              @location(1) normal: vec3<f32>) -> VertexOutput {
                    var output : VertexOutput;
                    output.Position = uniforms.modelViewProjectionMatrix * vec4<f32>(position, 1.0);
                    output.fragNormal = (uniforms.normalMatrix * vec4<f32>(normal, 0.0)).xyz;
                    return output;
                }

                @fragment
                fn fragmentMain(@location(0) fragNormal: vec3<f32>) -> @location(0) vec4<f32> {
                    return vec4<f32>(normalize(fragNormal) * 0.5 + 0.5, 1.0);
                }
            `,
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" },
        },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "vertexMain",
        buffers: [
          {
            arrayStride: 24,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x3" },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: this.format }],
      },
      primitive: {
        topology: "triangle-list",
        cullMode: "back",
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: "less",
        format: "depth24plus",
      },
    });

    this.depthTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.bindGroupLayout = bindGroupLayout;
  }

  render(cube) {
    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPassDescriptor = {
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.0, g: 0.0, b: 0.1, a: 1.0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    };

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setVertexBuffer(0, cube.vertexBuffer);
    passEncoder.setBindGroup(0, cube.bindGroup);
    passEncoder.draw(cube.vertexCount, 1, 0, 0);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }
}

class Cube {
  constructor(device, bindGroupLayout, canvasWidth, canvasHeight) {
    this.device = device;
    this.bindGroupLayout = bindGroupLayout;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.rotation = 0;
  }

  async initialize() {
    this.createGeometry();
    this.createBuffers();
    this.createUniformBuffer();
    this.createBindGroup();
  }

  createGeometry() {
    const positions = new Float32Array([
      // Front face
      -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
      // Back face
      -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1,
      // Top face
      -1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, -1,
      // Bottom face
      -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, 1,
      // Right face
      1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1,
      // Left face
      -1, -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1,
    ]);

    const normals = new Float32Array([
      // Front face
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
      // Back face
      0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
      // Top face
      0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
      // Bottom face
      0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
      // Right face
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
      // Left face
      -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    ]);

    this.vertices = new Float32Array(positions.length + normals.length);
    for (let i = 0; i < positions.length / 3; i++) {
      this.vertices[i * 6] = positions[i * 3];
      this.vertices[i * 6 + 1] = positions[i * 3 + 1];
      this.vertices[i * 6 + 2] = positions[i * 3 + 2];
      this.vertices[i * 6 + 3] = normals[i * 3];
      this.vertices[i * 6 + 4] = normals[i * 3 + 1];
      this.vertices[i * 6 + 5] = normals[i * 3 + 2];
    }

    this.vertexCount = positions.length / 3;
  }

  createBuffers() {
    this.vertexBuffer = this.device.createBuffer({
      size: this.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(this.vertexBuffer.getMappedRange()).set(this.vertices);
    this.vertexBuffer.unmap();
  }

  createUniformBuffer() {
    this.uniformBuffer = this.device.createBuffer({
      size: 16 * 4 * 2, // 2 4x4 matrices
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  createBindGroup() {
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer },
        },
      ],
    });
  }

  rotate(angle) {
    this.rotation += angle;
    const aspect = this.canvasWidth / this.canvasHeight;
    const projectionMatrix = mat4.perspective(
      mat4.create(),
      (2 * Math.PI) / 5,
      aspect,
      1,
      100.0
    );
    const viewMatrix = mat4.lookAt(
      mat4.create(),
      [0, 0, 5],
      [0, 0, 0],
      [0, 1, 0]
    );
    const modelMatrix = mat4.create();
    mat4.rotateY(modelMatrix, modelMatrix, this.rotation);

    const modelViewMatrix = mat4.multiply(
      mat4.create(),
      viewMatrix,
      modelMatrix
    );
    const modelViewProjectionMatrix = mat4.multiply(
      mat4.create(),
      projectionMatrix,
      modelViewMatrix
    );
    const normalMatrix = mat4.invert(mat4.create(), modelViewMatrix);
    mat4.transpose(normalMatrix, normalMatrix);

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      modelViewProjectionMatrix.buffer,
      modelViewProjectionMatrix.byteOffset,
      modelViewProjectionMatrix.byteLength
    );

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      64,
      normalMatrix.buffer,
      normalMatrix.byteOffset,
      normalMatrix.byteLength
    );
  }
}

async function main() {
  const canvas = document.getElementById("canvas");
  const renderer = new Renderer(canvas);
  await renderer.initialize();

  const cube = new Cube(
    renderer.device,
    renderer.bindGroupLayout,
    canvas.width,
    canvas.height
  );
  await cube.initialize();

  function frame() {
    cube.rotate(0.01);
    renderer.render(cube);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main();
