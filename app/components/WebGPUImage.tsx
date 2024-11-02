import { useRef, useEffect } from "react";

export default function WebGPUImage({ src }: { src: string }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    async function initWebGPU() {
      if (!canvas.current) return;

      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) {
        console.error("WebGPU not supported");
        return;
      }
      const device = await adapter.requestDevice();
      const context = canvas.current.getContext("webgpu");
      if (!context) return;

      const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
      context.configure({
        device,
        format: canvasFormat,
        alphaMode: "premultiplied",
      });

      // Create shader
      const shaderModule = device.createShaderModule({
        code: `
          @vertex
          fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
            var pos = array<vec2f, 3>(
              vec2f( 0.0,  0.5),
              vec2f(-0.5, -0.5),
              vec2f( 0.5, -0.5)
            );
            return vec4f(pos[vertexIndex], 0.0, 1.0);
          }

          @fragment
          fn fragmentMain() -> @location(0) vec4f {
            return vec4f(1.0, 0.0, 0.0, 1.0);
          }
        `,
      });

      // Create pipeline
      const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module: shaderModule,
          entryPoint: "vertexMain",
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fragmentMain",
          targets: [
            {
              format: canvasFormat,
            },
          ],
        },
        primitive: {
          topology: "triangle-list",
        },
      });

      // Create command encoder and render pass
      const commandEncoder = device.createCommandEncoder();
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });

      // Draw
      renderPass.setPipeline(pipeline);
      renderPass.draw(3, 1, 0, 0);
      renderPass.end();

      // Submit commands
      device.queue.submit([commandEncoder.finish()]);
    }

    initWebGPU();
  }, []);

  if (!src || src.length === 0) {
    return <div>Oh no, no src!</div>;
  }
  return <canvas ref={canvas} width={400} height={400}></canvas>;
}
