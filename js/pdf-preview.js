// Function to render a single PDF into a container
function renderPDF(url, container) {
  const loadingTask = pdfjsLib.getDocument(url);
  loadingTask.promise
    .then((pdf) => {
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        pdf.getPage(pageNum).then((page) => {
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.style.marginBottom = "16px"; // Optional: space between pages
          canvas.style.maxWidth = "100%"; // Optional: space between pages
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          canvas.classList.add("pdf-sheet");

          const context = canvas.getContext("2d");
          const renderContext = {
            canvasContext: context,
            viewport: viewport,
          };

          page.render(renderContext).promise.then(() => {
            container.appendChild(canvas);
          });
        });
      }
    })
    .catch((error) => {
      container.textContent = "Failed to load PDF: " + error.message;
    });
}

// Select all PDF containers and render each PDF
document.querySelectorAll(".pdf-file").forEach((container) => {
  const url = container.getAttribute("data-url"); // Get the PDF URL
  if (url) {
    renderPDF(url, container); // Call the render function
    container.querySelector(".spinner-border").remove();
  } else {
    container.textContent = "No PDF URL provided.";
  }
});
