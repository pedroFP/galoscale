/**
 * Render a PDF into a container using PDF.js, ensuring the file is at least a minimum size
 * @param {string|Blob|ArrayBuffer|TypedArray} src - PDF source (URL or binary)
 * @param {HTMLElement} container - Element that will receive page canvases
 * @param {Object} [options]
 * @param {number} [options.scale=1.5] - Render scale
 * @param {string} [options.className='pdf-sheet'] - CSS class added to each canvas
 * @param {number} [options.minBytes=5*1024] - Minimum PDF size required (defaults to 5KB)
 */
async function renderPDF(src, container, options = {}) {
  const {
    scale = 1.5,
    className = "pdf-sheet",
    minBytes = 5 * 1024, // 5KB
  } = options;

  // Helper: remove loader if present
  const removeLoader = () => {
    const loader = container.querySelector(".pdf-loader");
    if (loader) loader.remove();
  };

  // Resolve to ArrayBuffer + size, validating minBytes
  const toArrayBufferWithSize = async (input) => {
    removeLoader();
    // URL string
    if (typeof input === "string") {
      const res = await fetch(input);
      if (!res.ok) {
        throw new Error(`Failed to fetch PDF (HTTP ${res.status})`);
      }

      // Try header first (cheap), fallback to reading the body
      const headerLen = Number(res.headers.get("content-length"));
      if (!Number.isNaN(headerLen) && headerLen > 0) {
        if (headerLen < minBytes) {
          throw new Error(`PDF is too small: ${headerLen} bytes (min ${minBytes})`);
        }
        const buf = await res.arrayBuffer();
        return { buf, size: buf.byteLength };
      } else {
        // No content-length header; read the body and measure
        const buf = await res.arrayBuffer();
        if (buf.byteLength < minBytes) {
          throw new Error(`PDF is too small: ${buf.byteLength} bytes (min ${minBytes})`);
        }
        return { buf, size: buf.byteLength };
      }
    }

    // Blob (e.g., from file input)
    if (typeof Blob !== "undefined" && input instanceof Blob) {
      if (input.size < minBytes) {
        throw new Error(`PDF is too small: ${input.size} bytes (min ${minBytes})`);
      }
      const buf = await input.arrayBuffer();
      return { buf, size: buf.byteLength };
    }

    // ArrayBuffer or TypedArray
    if (input instanceof ArrayBuffer) {
      if (input.byteLength < minBytes) {
        throw new Error(`PDF is too small: ${input.byteLength} bytes (min ${minBytes})`);
      }
      return { buf: input, size: input.byteLength };
    }
    if (ArrayBuffer.isView(input)) {
      const size = input.byteLength ?? input.buffer?.byteLength ?? 0;
      if (size < minBytes) {
        throw new Error(`PDF is too small: ${size} bytes (min ${minBytes})`);
      }
      return { buf: input.buffer, size };
    }

    throw new Error("Unsupported PDF source type.");
  };

  try {
    const { buf } = await toArrayBufferWithSize(src);

    // Load PDF from validated bytes
    const loadingTask = pdfjsLib.getDocument({ data: buf });
    const pdf = await loadingTask.promise;

    // Render pages sequentially (predictable order, lower memory churn)
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.maxWidth = "100%";
      canvas.classList.add(className);

      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;

      container.appendChild(canvas);
    }
  } catch (err) {
    console.error("Failed to load or render PDF:", err);
    // Optional: surface a user-visible message
    const msg = document.createElement("div");
    msg.textContent = err?.message || "Failed to load PDF.";
    msg.className = "pdf-error";
    container.appendChild(msg);
  }
}

// Select all PDF containers and render each PDF
document.querySelectorAll(".pdf-file").forEach((container) => {
  const url = container.getAttribute("data-url"); // Get the PDF URL
  if (url) {
    renderPDF(url, container); // Call the render function
  } else {
    container.textContent = "No PDF URL provided.";
  }
});
