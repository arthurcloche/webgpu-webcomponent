import { useRef, useEffect, useState } from "react";

const SHADER_CODE = `
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

interface WebGPUImageProps {
  src: string;
  className?: string;
}

export default function WebGPUImage({ src, className }: WebGPUImageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [gpuContext, setGpuContext] = useState<{
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    bindGroup: GPUBindGroup;
    uniformBuffer: GPUBuffer;
  } | null>(null);
  const startTimeRef = useRef<number>(0);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const animationFrameRef = useRef<number>();
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const loadImage = async (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        resolve(img);
      };
      img.onerror = reject;
      img.src = src;
    });
  };

  const initDevice = async () => {
    if (!navigator.gpu) throw new Error("WebGPU not supported");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No adapter found");
    return await adapter.requestDevice();
  };

  const createTextureAndSampler = (
    device: GPUDevice,
    img: HTMLImageElement
  ) => {
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
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    return { texture, sampler };
  };

  const createBindGroup = (
    device: GPUDevice,
    sampler: GPUSampler,
    texture: GPUTexture,
    uniformBuffer: GPUBuffer
  ) => {
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
  };

  const createRenderPipeline = (
    device: GPUDevice,
    bindGroupLayout: GPUBindGroupLayout,
    canvasFormat: GPUTextureFormat
  ) => {
    const shaderModule = device.createShaderModule({
      code: SHADER_CODE,
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    return device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: canvasFormat }],
      },
      primitive: { topology: "triangle-strip" },
    });
  };

  useEffect(() => {
    let isActive = true;

    const initWebGPU = async () => {
      if (!canvas.current || !src) return;

      try {
        const img = await loadImage(src);
        if (!isActive) return;

        imageRef.current = img;
        canvas.current.width = img.width;
        canvas.current.height = img.height;

        const device = await initDevice();
        const context = canvas.current.getContext("webgpu");
        if (!context) throw new Error("Failed to get WebGPU context");

        const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
        context.configure({
          device,
          format: canvasFormat,
          alphaMode: "premultiplied",
        });

        const { texture, sampler } = createTextureAndSampler(device, img);
        const uniformBuffer = device.createBuffer({
          size: 48,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const { bindGroupLayout, bindGroup } = createBindGroup(
          device,
          sampler,
          texture,
          uniformBuffer
        );

        const pipeline = createRenderPipeline(
          device,
          bindGroupLayout,
          canvasFormat
        );

        startTimeRef.current = performance.now();
        setGpuContext({
          device,
          context,
          pipeline,
          bindGroup,
          uniformBuffer,
        });
      } catch (error) {
        console.error("Failed to initialize WebGPU:", error);
      }
    };
    // entry point
    initWebGPU();

    return () => {
      isActive = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [src]);

  useEffect(() => {
    if (!gpuContext) return;

    const render = () => {
      const { device, context, pipeline, bindGroup, uniformBuffer } =
        gpuContext;

      const uniformData = new Float32Array(12);
      uniformData.set([
        1,
        1,
        1,
        1,
        (performance.now() - startTimeRef.current) / 1000,
      ]);
      device.queue.writeBuffer(uniformBuffer, 0, uniformData);

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
      passEncoder.draw(4, 1, 0, 0);
      passEncoder.end();
      device.queue.submit([commandEncoder.finish()]);

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [gpuContext]);

  if (!src) {
    return <div>No source provided</div>;
  }

  return (
    <div
      style={{
        display: "inline-block",
        lineHeight: 0,
      }}
    >
      <canvas
        ref={canvas}
        width={dimensions?.width}
        height={dimensions?.height}
        className={className}
      />
    </div>
  );
}
