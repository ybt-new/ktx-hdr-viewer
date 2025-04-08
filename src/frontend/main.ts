import { WebGLRenderer, Scene, OrthographicCamera, MeshBasicMaterial, PlaneGeometry, Mesh, DataTexture, LinearFilter, FloatType, HalfFloatType, LinearSRGBColorSpace, Texture } from 'three';
import { RGBELoader, KTX2Loader } from "three/examples/jsm/Addons.js";

// @ts-ignore
const vscode = acquireVsCodeApi();

class Viewer {

  private render: () => void;
  private renderer: WebGLRenderer;
  private material: MeshBasicMaterial;
  private image: HTMLImageElement;
  private container: HTMLElement;

  constructor() {
    const scene = new Scene();

    const camera = new OrthographicCamera();
    camera.position.z = 1;

    const renderer = new WebGLRenderer({
      preserveDrawingBuffer: true,
    });

    const geometry = new PlaneGeometry(2, 2);
    const material = new MeshBasicMaterial();
    const mesh = new Mesh(geometry, material);
    scene.add(mesh);

    this.render = () => renderer.render(scene, camera);
    this.renderer = renderer;
    this.material = material;
    this.image = document.querySelector('.viewer-image')!;
    this.container = document.querySelector('.viewer-container')!;
  }

  private setUIState(state: 'loading' | 'error' | 'success') {
    this.container.classList.remove('loading', 'error', 'success');
    this.container.classList.add(state);
  }

  async previewHDR(data: HDRBody['data']) {
    this.setUIState('loading');

    try {
      const texture = new DataTexture();
      const rgbeLoader = new RGBELoader();
      const texData = rgbeLoader.parse(data.buffer as ArrayBuffer);

      if (texData.data !== undefined) {
        texture.image.width = texData.width;
        texture.image.height = texData.height;
        texture.image.data = texData.data;
      }

      if (texData.type !== undefined) {
        texture.type = texData.type;
      }

      if (texture.type === FloatType || texture.type === HalfFloatType) {
        texture.colorSpace = LinearSRGBColorSpace;
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.generateMipmaps = false;
        texture.flipY = true;
      }

      texture.needsUpdate = true;

      await this.previewImage(texture);

      this.setUIState('success');
    } catch (error) {
      this.setUIState('error');
      throw error;
    }
  }

  async previewKTX(data: KTXBody['data']) {
    this.setUIState('loading');

    try {
      const { ktxContent, transcoderPath } = data;
      const ktxLoader = new KTX2Loader();
      ktxLoader.setTranscoderPath(transcoderPath);
      ktxLoader.detectSupport(this.renderer);

      const texture = await new Promise<Texture>(resolve => {
        ktxLoader.parse(ktxContent.buffer as ArrayBuffer, resolve);
      });

      await this.previewImage(texture);

      this.setUIState('success');
    } catch (error) {
      this.setUIState('error');
      throw error;
    }
  }

  async previewImage(texture: Texture) {
    const { width, height } = texture.image;
    this.material.map = texture;
    this.material.needsUpdate = true;
    this.renderer.setSize(width, height);
    this.render();

    await new Promise((resolve, reject) => {
      this.renderer.domElement.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          this.image.src = url;
          this.image.addEventListener('load', resolve);
          this.image.addEventListener('error', reject);
        }
        else {
          reject(new Error('Failed to create blob from canvas: toBlob returned null'));
        }
      });
    });

    vscode.postMessage({
      type: 'size',
      body: { width, height },
    });
  }
}

interface HDRBody {
  extension: 'hdr'
  data: Uint8Array
}

interface KTXBody {
  extension: 'ktx2' | 'ktx'
  data: {
    ktxContent: Uint8Array
    transcoderPath: string
  }
}

interface Data {
  type: 'update'
  body: HDRBody | KTXBody
}

document.addEventListener("DOMContentLoaded", function () {
  const viewer = new Viewer();

  window.addEventListener('message', async (evt: MessageEvent<Data>) => {
    const { type, body } = evt.data as Data;

    try {
      if (type === 'update') {
        if (body.extension === 'hdr') {
          await viewer.previewHDR(body.data);
        }
        else if (body.extension === 'ktx' || body.extension === 'ktx2') {
          await viewer.previewKTX(body.data);
        }
      }
    } catch (error) {
      console.error('[KTX-HDR Viewer]', error);
      vscode.postMessage({
        type: 'error',
        body: {
          message: error instanceof Error ? error.message : 'Unknown error',
        }
      });
    }

  });

  vscode.postMessage({ type: 'ready' });
});
