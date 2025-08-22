/**
 * Render a PDF into a container using PDF.js
 * @param {string|TypedArray|PDFDataRangeTransport} url - PDF source for pdfjsLib.getDocument
 * @param {HTMLElement} container - Element that will receive page canvases
 * @param {Object} [options]
 * @param {number} [options.scale=1.5] - Render scale
 * @param {string} [options.className='pdf-sheet'] - CSS class for each canvas
 */
async function renderPDF(url, container, options = {}) {
  const { scale = 1.5, className = "pdf-sheet" } = options;

  let loadingTask;
  try {
    loadingTask = pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;

    // Render all pages in parallel, then append in order
    const canvases = await Promise.all(
      Array.from({ length: pdf.numPages }, async (_, i) => {
        const pageNum = i + 1;
        const page = await pdf.getPage(pageNum);

        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.style.maxWidth = "100%";
        canvas.height = viewport.height;
        canvas.classList.add(className);

        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;

        return canvas;
      })
    );

    // Batch DOM writes for performance
    const frag = document.createDocumentFragment();
    canvases.forEach((c) => frag.appendChild(c));
    container.appendChild(frag);
  } catch (err) {
    console.error("Failed to load or render PDF:", err);
  } finally {
    // Remove loader if present
    const loader = container.querySelector(".pdf-loader");
    if (loader) loader.remove();
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
