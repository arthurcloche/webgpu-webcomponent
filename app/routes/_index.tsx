import type { MetaFunction } from "@remix-run/node";
import WebGPUImage from "~/components/WebGPUImage";
export const meta: MetaFunction = () => {
  return [
    { title: "WebGPU Image" },
    { name: "description", content: "Hello World" },
  ];
};

const imageSrc =
  "https://cdn.shopify.com/s/files/1/0817/9308/9592/files/crystal.png?v=1722451245";

export default function Index() {
  return (
    <div className="main ">
      <h1>Hello World</h1>
      <WebGPUImage src={imageSrc} className="w-[300px] h-auto" />
    </div>
  );
}
