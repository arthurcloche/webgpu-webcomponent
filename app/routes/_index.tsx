import type { MetaFunction } from "@remix-run/node";
import { Suspense } from "react";
import WebGPUImage from "~/components/WebGPUImage";

const aspectRatios = [
  { width: 400, height: 400 }, // 1:1
  { width: 640, height: 360 }, // 16:9
  { width: 360, height: 640 }, // 9:16
  { width: 400, height: 300 }, // 4:3
  { width: 300, height: 500 }, // 3:5
  { width: 500, height: 800 }, // 5:8
  { width: 800, height: 500 }, // 8:5
];
const numImages = 240;
const images = Array.from({ length: numImages }, (_, i) => {
  const ratio = aspectRatios[i % aspectRatios.length];
  const applyOffsetToWidth =
    Math.random() < 0.5 ? 0 : Math.floor(Math.random() * 100);
  const applyOffsetToHeight =
    Math.random() < 0.5 ? 0 : Math.floor(Math.random() * 100);
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
      <Suspense fallback={<div>Loading...</div>}>
        <div className="grid grid-cols-3 gap-4 mt-4">
          {images.map((img) => (
            <WebGPUImage key={img.id} src={img.src} className="w-full h-auto" />
          ))}
        </div>
      </Suspense>
    </div>
  );
}
