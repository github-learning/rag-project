/**
 * pdf-parse@2 依赖的 pdfjs-dist 在浏览器外会引用全局 DOMMatrix。
 * 在 Nest 进程入口最先 import 本文件，避免解析 PDF 时报 ReferenceError。
 */
export function installDomMatrixPolyfill(): void {
  const g = globalThis as typeof globalThis & { DOMMatrix?: typeof DOMMatrix };
  if (typeof g.DOMMatrix !== 'undefined') return;

  class DOMMatrixPolyfill {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;

    constructor(init?: string | number[]) {
      if (Array.isArray(init) && init.length >= 6) {
        this.a = Number(init[0]);
        this.b = Number(init[1]);
        this.c = Number(init[2]);
        this.d = Number(init[3]);
        this.e = Number(init[4]);
        this.f = Number(init[5]);
      }
    }

    multiply(other: DOMMatrixPolyfill): DOMMatrixPolyfill {
      const out = new DOMMatrixPolyfill();
      out.a = this.a * other.a + this.c * other.b;
      out.c = this.a * other.c + this.c * other.d;
      out.e = this.a * other.e + this.c * other.f + this.e;
      out.b = this.b * other.a + this.d * other.b;
      out.d = this.b * other.c + this.d * other.d;
      out.f = this.b * other.e + this.d * other.f + this.f;
      return out;
    }

    multiplySelf(other: DOMMatrixPolyfill): this {
      const m = this.multiply(other);
      this.a = m.a;
      this.b = m.b;
      this.c = m.c;
      this.d = m.d;
      this.e = m.e;
      this.f = m.f;
      return this;
    }

    translateSelf(): this {
      return this;
    }

    scaleSelf(): this {
      return this;
    }

    rotateSelf(): this {
      return this;
    }

    invertSelf(): this {
      return this;
    }
  }

  g.DOMMatrix = DOMMatrixPolyfill as unknown as typeof DOMMatrix;
}

installDomMatrixPolyfill();
