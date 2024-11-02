import { useRef, useEffect, useState } from "react";

const SHADER_CODE = `
  struct Uniforms {
    tintColor: vec4f,
    mousePos: vec2f,
    resolution: vec2f,
    isHovered: f32,
    time: f32,
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

  fn offset(uv: vec2f) -> vec2f {
    let amplitude = 0.025;
    let frequency = 10.0;
    let phase = uniforms.time * 10.0;
    let mouseDistance = distance(uv, uniforms.mousePos);
    let waveStrength = uniforms.isHovered * smoothstep(0.0, 0.5, mouseDistance);
    return (uv + vec2f(
      amplitude * sin(frequency * uv.x + phase) * waveStrength,
      amplitude * sin(frequency * uv.x + phase) * waveStrength
    ));
  }

  @fragment
  fn fragmentMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let offsetUV = offset(uv);
    let texColor = textureSample(tex, texSampler, offsetUV);
    return texColor * uniforms.tintColor;
  }
`;

interface WebGPUImageProps {
  src: string;
  className?: string;
  onLoad?: () => void;
}

function WebGPURenderer({ src, className, onLoad }: WebGPUImageProps) {
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
  const [isHovered, setIsHovered] = useState(false);
  const [mousePos, setMousePos] = useState<[number, number]>([0, 0]);

  const loadImage = async (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        onLoad?.();
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
      label: "bindGroup0",
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
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    console.log(bindGroupLayout);
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
          size: 64,
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

      const time = (performance.now() - startTimeRef.current) / 1000;

      const uniformData = new Float32Array([
        1,
        1,
        1,
        1, // tintColor (vec4f)
        mousePos[0],
        mousePos[1], // mousePos (vec2f)
        canvas.current?.width || 0, // resolution (vec2f)
        canvas.current?.height || 0,
        isHovered ? 1 : 0,
        time, // isHovered (f32)
        0,
        0,
        0, // padding to align to 16 bytes
      ]);

      // Debug log every few frames
      //   if (Math.floor(time) % 2 === 0) {
      //     console.log("Uniform data:", {
      //       time,
      //       mousePos,
      //       isHovered,
      //       uniformData: Array.from(uniformData),
      //     });
      //   }

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
  }, [gpuContext, mousePos, isHovered]);

  const saturate = (value: number) => {
    return Math.min(Math.max(value, 0), 1);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvas.current) return;
    const rect = canvas.current.getBoundingClientRect();
    const x = saturate((e.clientX - rect.left) / rect.width);
    const y = saturate((e.clientY - rect.top) / rect.height);
    setMousePos([x, y]);
  };

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
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />
    </div>
  );
}

export default function WebGPUImage({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <div>
      {isLoading && <div className="w-full h-full bg-gray-200 animate-pulse" />}
      <WebGPURenderer
        src={src}
        className={className}
        onLoad={() => setIsLoading(false)}
      />
    </div>
  );
}
