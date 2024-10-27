# Learning WebGPU

## WebGPU Image

## Key learnings

- WebGPU is stateless: All state changes must be explicitly defined in command encoders. We set up pipelines, bind groups, and vertex buffers for each render pass.

- WebGPU is asynchronous: Operations like device creation and texture loading are asynchronous. Our main() function is async, and we use promises for image loading.

- WebGPU is a low-level API: It provides fine-grained control over GPU operations. Our shaders demonstrate this, allowing precise manipulation of vertices and fragments.

- WebGPU is a parallel API: It's designed for parallel processing on GPUs. Our shaders process multiple pixels simultaneously, and we use concepts like bind groups to efficiently manage data across parallel executions.

- WebGPU uses a compile-ahead model: Pipelines and bind group layouts are created upfront, improving runtime performance. This is seen in our createPipeline() and createBindGroup() methods.

- WebGPU provides explicit memory management: We create and manage buffers and textures directly, as seen in our texture creation and uniform buffer updates.
