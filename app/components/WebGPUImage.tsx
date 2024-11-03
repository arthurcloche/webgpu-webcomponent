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
  const [isVisible, setIsVisible] = useState(false);
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
  const [error, setError] = useState<string | null>(null);

  const loadImage = async (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        onLoad?.();
        resolve(img);
      };
      img.onerror = (e) =>
        reject(new Error(`Failed to load image: ${src}. ${e}`));
      img.src = src;
    });
  };

  const initDevice = async () => {
    if (!navigator.gpu) {
      throw new Error(
        "Your browser doesn't support WebGPU. Please try a compatible browser like Chrome Canary."
      );
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error(
        "No WebGPU adapter found. Your GPU might not be supported."
      );
    }
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
    let observer: IntersectionObserver;
    const initWebGPU = async () => {
      if (!canvas.current || !src) return;

      try {
        observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              setIsVisible(entry.isIntersecting);
            });
          },
          {
            root: null,
            rootMargin: "50px", // distance to start loading before the element is visible
            threshold: 0.01,
          }
        );

        observer.observe(canvas.current);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "An unknown error occurred";
        console.error("Failed to initialize Intersection Observer:", error);
        setError(errorMessage);
      }

      try {
        const img = await loadImage(src);
        if (!isActive) return;

        imageRef.current = img;
        canvas.current.width = img.width;
        canvas.current.height = img.height;

        const device = await initDevice();
        const context = canvas.current.getContext("webgpu");
        if (!context) {
          throw new Error(
            "Failed to get WebGPU context. Your browser might not support WebGPU."
          );
        }

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
        const errorMessage =
          error instanceof Error ? error.message : "An unknown error occurred";
        console.error("Failed to initialize WebGPU:", error);
        setError(errorMessage);
      }
    };

    initWebGPU();

    return () => {
      observer?.disconnect();
      isActive = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [src]);

  useEffect(() => {
    if (!gpuContext || !isVisible) return;

    const render = () => {
      const { device, context, pipeline, bindGroup, uniformBuffer } =
        gpuContext;

      const time = (performance.now() - startTimeRef.current) / 1000;

      const uniformData = new Float32Array([
        1, // tintColor (vec4f)
        1,
        1,
        1,
        mousePos[0], // (vec2f)
        mousePos[1],
        canvas.current?.width || 0, // (vec2f)
        canvas.current?.height || 0,
        isHovered ? 1 : 0, //  (f32)
        time, //  (f32)
        0, // padding to align to 16 bytes
        0,
        0,
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
  }, [gpuContext, mousePos, isHovered, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    }
  }, [isVisible]);

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

  if (error) {
    return (
      <div className="relative p-4 border border-red-300 bg-red-50 rounded-md">
        <p className="text-red-700">Failed to load WebGPU image: {error}</p>
        <p className="text-sm text-red-500 mt-2">
          Try refreshing the page or using a WebGPU-compatible browser.
        </p>
      </div>
    );
  }

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
    <div className="relative">
      {isLoading && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse" />
      )}
      <WebGPURenderer
        src={src}
        className={className}
        onLoad={() => setIsLoading(false)}
      />
    </div>
  );
}
