import type { MetaFunction } from "@remix-run/node";
import WebGPUImage from "~/components/WebGPUImage";
import { Suspense } from "react";

const aspectRatios = [
  { width: 400, height: 400 }, // 1:1
  { width: 640, height: 360 }, // 16:9
  { width: 360, height: 640 }, // 9:16
  { width: 400, height: 300 }, // 4:3
  { width: 300, height: 500 }, // 3:5
  { width: 500, height: 800 }, // 5:8
  { width: 800, height: 500 }, // 8:5
];

const images = Array.from({ length: 72 }, (_, i) => {
  const ratio = aspectRatios[i % aspectRatios.length];
  const offset = 100;
  const applyOffsetToWidth = Math.random() < 0.5 ? 0 : offset;
  const applyOffsetToHeight = Math.random() < 0.5 ? 0 : offset;
  return {
    id: i,
    src: `https://picsum.photos/${ratio.width + applyOffsetToWidth}/${
      ratio.height + applyOffsetToHeight
    }`,
  };
});

export const meta: MetaFunction = () => {
  return [
    { title: "WebGPU Image" },
    { name: "description", content: "Hello World" },
  ];
};

export default function Index() {
  return (
    <div className="main p-4">
      <h1>Hello World</h1>
      <Suspense
        fallback={
          <div className="grid grid-cols-3 gap-4 mt-4">
            {Array.from({ length: 21 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square bg-gray-200 animate-pulse"
              />
            ))}
          </div>
        }
      >
        <div className="grid grid-cols-3 gap-4 mt-4">
          {images.map((img) => (
            <WebGPUImage key={img.id} src={img.src} className="w-full h-auto" />
          ))}
        </div>
      </Suspense>
    </div>
  );
}
