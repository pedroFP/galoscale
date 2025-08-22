/**
 * Lazy-render a PDF into a container using PDF.js.
 * - Verifies the source is at least minBytes (5 KB by default).
 * - Creates page placeholders first to avoid layout shift.
 * - Renders a page when it scrolls near the viewport.
 *
 * @param {string|Blob|ArrayBuffer|TypedArray} src
 * @param {HTMLElement} container
 * @param {Object} [options]
 * @param {number} [options.scale=1.5]
 * @param {string} [options.className='pdf-sheet']
 * @param {number} [options.minBytes=5*1024]
 * @param {string} [options.rootMargin='600px'] - how far before the viewport to start rendering
 * @param {number} [options.concurrent=2] - max pages rendering at once
 */
async function renderPDFLazy(src, container, options = {}) {
	const {
		scale = 1.5,
		className = "pdf-sheet",
		minBytes = 5 * 1024,
		rootMargin = "600px",
		concurrent = 2,
	} = options;

	// ---- helpers ----
	const removeLoader = () => {
		const loader = container.querySelector(".pdf-loader");
		if (loader) loader.remove();
	};

	const toArrayBufferWithSize = async (input) => {
		if (typeof input === "string") {
			const res = await fetch(input);
			if (!res.ok) throw new Error(`Failed to fetch PDF (HTTP ${res.status})`);
			const len = Number(res.headers.get("content-length"));
			if (!Number.isNaN(len) && len > 0 && len < minBytes) {
				throw new Error(`PDF is too small: ${len} bytes (min ${minBytes})`);
			}
			const buf = await res.arrayBuffer();
			if (buf.byteLength < minBytes) {
				throw new Error(`PDF is too small: ${buf.byteLength} bytes (min ${minBytes})`);
			}
			return buf;
		}
		if (typeof Blob !== "undefined" && input instanceof Blob) {
			if (input.size < minBytes) {
				throw new Error(`PDF is too small: ${input.size} bytes (min ${minBytes})`);
			}
			return await input.arrayBuffer();
		}
		if (input instanceof ArrayBuffer) {
			if (input.byteLength < minBytes) {
				throw new Error(`PDF is too small: ${input.byteLength} bytes (min ${minBytes})`);
			}
			return input;
		}
		if (ArrayBuffer.isView(input)) {
			const size = input.byteLength ?? input.buffer?.byteLength ?? 0;
			if (size < minBytes) {
				throw new Error(`PDF is too small: ${size} bytes (min ${minBytes})`);
			}
			return input.buffer;
		}
		throw new Error("Unsupported PDF source type.");
	};

	// ---- main ----
	let observer;
	const inFlight = new Set(); // pages currently rendering (page numbers)
	try {
		const data = await toArrayBufferWithSize(src);
		const loadingTask = pdfjsLib.getDocument({ data });
		const pdf = await loadingTask.promise;

		// Get first page to compute aspect ratio at chosen scale
		const firstPage = await pdf.getPage(1);
		const firstViewport = firstPage.getViewport({ scale });
		const aspectRatio = firstViewport.height / firstViewport.width;

		// Build placeholders for all pages up-front (cheap DOM)
		const frag = document.createDocumentFragment();
		for (let i = 1; i <= pdf.numPages; i++) {
			const holder = document.createElement("div");
			holder.className = "pdf-page-holder";
			holder.dataset.page = String(i);

			// Use intrinsic ratio box to avoid CLS
			const sizer = document.createElement("div");
			sizer.className = "pdf-page-sizer";
			sizer.style.paddingTop = `${aspectRatio * 100}%`;

			const content = document.createElement("div");
			content.className = "pdf-page-content"; // will receive the canvas

			holder.appendChild(sizer);
			holder.appendChild(content);
			frag.appendChild(holder);
		}
		container.appendChild(frag);
		removeLoader();

		// Renderer with simple concurrency gate
		const renderPage = async (pageNum) => {
			if (inFlight.has(pageNum)) return;
			inFlight.add(pageNum);

			try {
				const page = await pdf.getPage(pageNum);
				const viewport = page.getViewport({ scale });

				const canvas = document.createElement("canvas");
				canvas.width = viewport.width;
				canvas.height = viewport.height;
				canvas.style.maxWidth = "100%";

				canvas.classList.add(className);

				const ctx = canvas.getContext("2d");
				await page.render({ canvasContext: ctx, viewport }).promise;

				const holder = container.querySelector(`.pdf-page-holder[data-page="${pageNum}"]`);
				if (holder) {
					const content = holder.querySelector(".pdf-page-content");
					content.innerHTML = ""; // clear skeleton
					content.appendChild(canvas);
					holder.classList.add("pdf-page-rendered");
				}
			} catch (e) {
				// Surface an inline error for this page
				const holder = container.querySelector(`.pdf-page-holder[data-page="${pageNum}"]`);
				if (holder) {
					const content = holder.querySelector(".pdf-page-content");
					const err = document.createElement("div");
					err.className = "pdf-error";
					err.textContent = e?.message || `Failed to render page ${pageNum}`;
					content.innerHTML = "";
					content.appendChild(err);
				}
				console.error(`Failed to render page ${pageNum}:`, e);
			} finally {
				inFlight.delete(pageNum);
			}
		};

		// Queue with concurrency control
		const queue = [];
		let active = 0;

		const pump = () => {
			while (active < concurrent && queue.length) {
				const next = queue.shift();
				if (!next) break;
				active++;
				renderPage(next).finally(() => {
					active--;
					pump();
				});
			}
		};

		const enqueue = (pageNum) => {
			if (!queue.includes(pageNum) && !inFlight.has(pageNum)) {
				queue.push(pageNum);
				pump();
			}
		};

		// Observe holders entering near-viewport
		observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const pageNum = Number(entry.target.dataset.page);
						const already = entry.target.classList.contains("pdf-page-rendered");
						if (!already) enqueue(pageNum);
					}
				}
			},
			{ root: null, rootMargin, threshold: 0.01 }
		);

		container.querySelectorAll(".pdf-page-holder").forEach((el) => observer.observe(el));

		// Return a small API for optional teardown (if you store the promise)
		return {
			disconnect() {
				if (observer) observer.disconnect();
			},
		};
	} catch (err) {
		console.error("Failed to load or initialize PDF:", err);
		const msg = document.createElement("div");
		msg.textContent = err?.message || "Failed to load PDF.";
		msg.className = "pdf-error";
		container.appendChild(msg);
	} finally {
		removeLoader();
	}
}


// Select all PDF containers and render each PDF
document.querySelectorAll(".pdf-file").forEach((container) => {
	const url = container.getAttribute("data-url"); // Get the PDF URL
	if (url) {
		renderPDFLazy(url, container); // Call the render function
	} else {
		container.textContent = "No PDF URL provided.";
	}
});
