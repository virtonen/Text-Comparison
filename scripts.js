const BACKEND_URL = 'https://backend-compare.onrender.com';

async function apiCall(path, method = 'GET', payload = null) {
  const config = { method, credentials: 'include' };
  if (payload) {
    config.headers = { 'Content-Type': 'application/json' };
    config.body = JSON.stringify(payload);
  }
  const res = await fetch(BACKEND_URL + path, config);
  return res.ok ? res.json() : {};
}

// Restore session + saved text on load
window.addEventListener('load', async () => {
  await apiCall('/set-session', 'POST', { userId: 'user_' + Date.now() });
  const data = await apiCall('/get-session');
  const ta = document.getElementById('text2');
  if (data.user_text && ta) {
    ta.value = data.user_text;
    console.log('✅ Restored text from cookie (virtonen/Text-Comparison)');
  }
});

// Auto-save Modified text while typing (debounced)
const ta = document.getElementById('text2');
if (ta) {
  let timer;
  ta.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => apiCall('/save-input', 'POST', { text: e.target.value }), 800);
  });
}

document.addEventListener('DOMContentLoaded', (event) => {
    // Set up PDF.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // Text comparison event listeners
    document.getElementById('compareButton').addEventListener('click', () => {
        const text1 = document.getElementById('text1').value;
        const text2 = document.getElementById('text2').value;
        const outputOriginal = document.getElementById('outputOriginalContent');
        const outputModified = document.getElementById('outputModifiedContent');

        const diff = getDiff(text1, text2);
        outputOriginal.innerHTML = diff.originalHtml;
        outputModified.innerHTML = diff.modifiedHtml;
        updateHeaderStats(diff.stats);
    });

    document.getElementById('resetButton').addEventListener('click', () => {
        document.getElementById('text1').value = '';
        document.getElementById('text2').value = '';
        document.getElementById('outputOriginalContent').innerHTML = '';
        document.getElementById('outputModifiedContent').innerHTML = '';
        resetHeaderStats();
    });

    // Mode toggle event listeners
    document.getElementById('textModeBtn').addEventListener('click', () => {
        setMode('text');
    });

    document.getElementById('pdfModeBtn').addEventListener('click', () => {
        setMode('pdf');
    });

    // PDF event listeners
    document.getElementById('pdfOriginal').addEventListener('change', handlePdfUpload('original'));
    document.getElementById('pdfModified').addEventListener('change', handlePdfUpload('modified'));
    document.getElementById('comparePdfButton').addEventListener('click', comparePdfs);
    document.getElementById('resetPdfButton').addEventListener('click', resetPdfs);
    document.getElementById('prevPage').addEventListener('click', () => changePage(-1));
    document.getElementById('nextPage').addEventListener('click', () => changePage(1));
    resetHeaderStats();
});

// Mode switching
function setMode(mode) {
    const textSection = document.getElementById('textSection');
    const pdfSection = document.getElementById('pdfSection');
    const textModeBtn = document.getElementById('textModeBtn');
    const pdfModeBtn = document.getElementById('pdfModeBtn');

    if (mode === 'text') {
        textSection.style.display = 'flex';
        pdfSection.style.display = 'none';
        textModeBtn.classList.add('active');
        pdfModeBtn.classList.remove('active');
    } else {
        textSection.style.display = 'none';
        pdfSection.style.display = 'flex';
        textModeBtn.classList.remove('active');
        pdfModeBtn.classList.add('active');
    }
}

// PDF State
const pdfState = {
    originalPdf: null,
    modifiedPdf: null,
    originalTextItems: [],
    modifiedTextItems: [],
    currentPage: 1,
    totalPages: 1,
    scale: 1.5,
    comparisonDone: false
};

// Handle PDF upload
function handlePdfUpload(type) {
    return async function(event) {
        const file = event.target.files[0];
        if (!file) return;

        const filenameSpan = document.getElementById(type === 'original' ? 'pdfOriginalName' : 'pdfModifiedName');
        filenameSpan.textContent = file.name;

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        if (type === 'original') {
            pdfState.originalPdf = pdf;
        } else {
            pdfState.modifiedPdf = pdf;
        }

        // Reset comparison state when new PDF is loaded
        pdfState.comparisonDone = false;
        document.getElementById('pdfStatsContainer').style.display = 'none';
        
        // Update total pages to min of both PDFs if both are loaded
        updatePageCount();
        
        // Render preview
        if (type === 'original' && pdfState.originalPdf) {
            await renderPdfPage(pdfState.originalPdf, 1, 'pdfCanvasOriginal', 'annotationOriginal');
        } else if (type === 'modified' && pdfState.modifiedPdf) {
            await renderPdfPage(pdfState.modifiedPdf, 1, 'pdfCanvasModified', 'annotationModified');
        }
    };
}

function updatePageCount() {
    if (pdfState.originalPdf && pdfState.modifiedPdf) {
        pdfState.totalPages = Math.max(pdfState.originalPdf.numPages, pdfState.modifiedPdf.numPages);
    } else if (pdfState.originalPdf) {
        pdfState.totalPages = pdfState.originalPdf.numPages;
    } else if (pdfState.modifiedPdf) {
        pdfState.totalPages = pdfState.modifiedPdf.numPages;
    }
    updatePageInfo();
}

function updatePageInfo() {
    document.getElementById('pageInfo').textContent = `Page ${pdfState.currentPage} of ${pdfState.totalPages}`;
    document.getElementById('prevPage').disabled = pdfState.currentPage <= 1;
    document.getElementById('nextPage').disabled = pdfState.currentPage >= pdfState.totalPages;
}

async function changePage(delta) {
    const newPage = pdfState.currentPage + delta;
    if (newPage < 1 || newPage > pdfState.totalPages) return;
    
    pdfState.currentPage = newPage;
    updatePageInfo();

    // Re-render current page
    if (pdfState.originalPdf) {
        await renderPdfPage(pdfState.originalPdf, pdfState.currentPage, 'pdfCanvasOriginal', 'annotationOriginal');
    }
    if (pdfState.modifiedPdf) {
        await renderPdfPage(pdfState.modifiedPdf, pdfState.currentPage, 'pdfCanvasModified', 'annotationModified');
    }

    // Re-apply highlights if comparison was done
    if (pdfState.comparisonDone) {
        await applyHighlightsForCurrentPage();
    }
}

// Render a PDF page to canvas
async function renderPdfPage(pdf, pageNum, canvasId, annotationId) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    const annotationLayer = document.getElementById(annotationId);
    const wrapper = canvas.parentElement;
    
    if (pageNum > pdf.numPages) {
        // Clear canvas if page doesn't exist
        canvas.width = 0;
        canvas.height = 0;
        annotationLayer.innerHTML = '';
        return null;
    }

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: pdfState.scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Set up wrapper and annotation layer dimensions to match canvas
    wrapper.style.width = viewport.width + 'px';
    wrapper.style.height = viewport.height + 'px';
    annotationLayer.style.width = viewport.width + 'px';
    annotationLayer.style.height = viewport.height + 'px';

    await page.render({
        canvasContext: ctx,
        viewport: viewport
    }).promise;

    return { page, viewport };
}

// Extract text with coordinates from a PDF using PDF.js text layer approach
async function extractTextWithCoordinates(pdf) {
    const allTextItems = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: pdfState.scale });
        const textContent = await page.getTextContent();

        // Process each text item and compute its bounding box
        const pageTextItems = [];
        
        for (const item of textContent.items) {
            if (!item.str || item.str.trim().length === 0) continue;
            
            // Use PDF.js utility to transform coordinates properly
            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            
            // Extract font size from the transform matrix
            // The font size is encoded in tx[0] (horizontal scale) or tx[3] (vertical scale)
            const fontHeight = Math.abs(tx[3]);
            const fontScaleX = Math.abs(tx[0]);
            
            // Position in viewport coordinates
            const x = tx[4];
            const y = tx[5] - fontHeight; // tx[5] is baseline, subtract height to get top
            
            // Calculate width properly
            // item.width from PDF.js getTextContent is in glyph space units
            // It needs to be scaled by the font's horizontal scale factor
            // The transform already includes the scale, so we multiply item.width by fontScaleX
            let width;
            if (item.width && item.width > 0 && item.width < 1000) {
                // item.width appears to be in PDF points, scale by viewport scale
                width = item.width * pdfState.scale;
            } else {
                // Fallback: estimate width from character count
                const avgCharWidth = fontHeight * 0.55;
                width = item.str.length * avgCharWidth;
            }
            
            // Sanity checks
            if (width > viewport.width) width = item.str.length * fontHeight * 0.55;
            if (x < 0 || x > viewport.width) continue;
            if (y < 0 || y > viewport.height) continue;
            
            pageTextItems.push({
                text: item.str,
                x: x,
                y: y,
                width: width,
                height: fontHeight,
                pageNum: pageNum
            });
        }

        // Build full text from items
        const fullText = pageTextItems.map(i => i.text).join(' ');

        allTextItems.push({
            pageNum,
            items: pageTextItems,
            fullText: fullText
        });
    }

    return allTextItems;
}

// Compare PDFs
async function comparePdfs() {
    if (!pdfState.originalPdf || !pdfState.modifiedPdf) {
        alert('Please upload both PDFs before comparing.');
        return;
    }

    // Show navigation
    document.getElementById('pdfNavigation').style.display = 'flex';

    // Extract text with coordinates from both PDFs
    pdfState.originalTextItems = await extractTextWithCoordinates(pdfState.originalPdf);
    pdfState.modifiedTextItems = await extractTextWithCoordinates(pdfState.modifiedPdf);

    pdfState.comparisonDone = true;
    pdfState.currentPage = 1;
    updatePageInfo();

    // Render first page of both PDFs
    await renderPdfPage(pdfState.originalPdf, 1, 'pdfCanvasOriginal', 'annotationOriginal');
    await renderPdfPage(pdfState.modifiedPdf, 1, 'pdfCanvasModified', 'annotationModified');

    // Apply highlights
    await applyHighlightsForCurrentPage();
}

// Apply highlights for the current page
async function applyHighlightsForCurrentPage() {
    const pageNum = pdfState.currentPage;
    
    // Get text items for current page
    const originalPage = pdfState.originalTextItems.find(p => p.pageNum === pageNum);
    const modifiedPage = pdfState.modifiedTextItems.find(p => p.pageNum === pageNum);

    // Clear existing highlights
    document.getElementById('annotationOriginal').innerHTML = '';
    document.getElementById('annotationModified').innerHTML = '';

    if (!originalPage && !modifiedPage) return;

    // Get words with their positions from each page
    const originalWords = extractWordsWithPositions(originalPage ? originalPage.items : []);
    const modifiedWords = extractWordsWithPositions(modifiedPage ? modifiedPage.items : []);

    // Get the text for diff comparison
    const originalText = originalWords.map(w => w.text).join(' ');
    const modifiedText = modifiedWords.map(w => w.text).join(' ');

    // Get word-level diff
    const diff = Diff.diffWords(originalText, modifiedText);

    // Track word indices for highlighting
    let originalWordIdx = 0;
    let modifiedWordIdx = 0;
    let removedCount = 0;
    let addedCount = 0;

    diff.forEach(part => {
        const words = part.value.trim().split(/\s+/).filter(w => w.length > 0);
        const wordCount = words.length;

        if (part.removed) {
            // Highlight words in original PDF
            for (let i = 0; i < wordCount && originalWordIdx < originalWords.length; i++) {
                const wordInfo = originalWords[originalWordIdx];
                if (wordInfo) {
                    createHighlight('annotationOriginal', wordInfo, 'removed');
                }
                originalWordIdx++;
            }
            removedCount += wordCount;
        } else if (part.added) {
            // Highlight words in modified PDF
            for (let i = 0; i < wordCount && modifiedWordIdx < modifiedWords.length; i++) {
                const wordInfo = modifiedWords[modifiedWordIdx];
                if (wordInfo) {
                    createHighlight('annotationModified', wordInfo, 'added');
                }
                modifiedWordIdx++;
            }
            addedCount += wordCount;
        } else {
            // Unchanged - advance both indices
            originalWordIdx += wordCount;
            modifiedWordIdx += wordCount;
        }
    });

    // Update stats
    document.getElementById('pdfStatsContainer').style.display = 'flex';
    document.getElementById('pdfRemovedCount').textContent = `Removed: ${removedCount} words`;
    document.getElementById('pdfAddedCount').textContent = `Added: ${addedCount} words`;
}

// Extract words with their bounding boxes from text items
function extractWordsWithPositions(items) {
    const words = [];
    
    items.forEach(item => {
        const text = item.text;
        if (!text || text.trim().length === 0) return;
        
        // Split item text into words
        const itemWords = text.split(/(\s+)/);
        let xOffset = 0;
        const charWidth = item.width / Math.max(text.length, 1);
        
        itemWords.forEach(word => {
            if (word.trim().length > 0) {
                words.push({
                    text: word,
                    x: item.x + xOffset,
                    y: item.y,
                    width: word.length * charWidth,
                    height: item.height
                });
            }
            xOffset += word.length * charWidth;
        });
    });
    
    return words;
}

// Create a highlight element
function createHighlight(containerId, rect, type) {
    const container = document.getElementById(containerId);
    
    // Get container dimensions for bounds checking
    const containerWidth = parseFloat(container.style.width) || container.offsetWidth;
    const containerHeight = parseFloat(container.style.height) || container.offsetHeight;
    
    // Skip highlights that are completely outside bounds
    if (rect.x < 0 || rect.y < 0 || rect.x > containerWidth || rect.y > containerHeight) {
        return;
    }
    
    // Clamp dimensions to stay within container
    const x = Math.max(0, rect.x);
    const y = Math.max(0, rect.y);
    const width = Math.min(rect.width, containerWidth - x);
    const height = Math.min(rect.height + 4, containerHeight - y);
    
    // Skip very small or invalid highlights
    if (width <= 0 || height <= 0) return;
    
    const highlight = document.createElement('div');
    highlight.className = `pdf-highlight ${type}`;
    highlight.style.left = x + 'px';
    highlight.style.top = y + 'px';
    highlight.style.width = width + 'px';
    highlight.style.height = height + 'px';
    container.appendChild(highlight);
}

// Reset PDFs
function resetPdfs() {
    pdfState.originalPdf = null;
    pdfState.modifiedPdf = null;
    pdfState.originalTextItems = [];
    pdfState.modifiedTextItems = [];
    pdfState.currentPage = 1;
    pdfState.totalPages = 1;
    pdfState.comparisonDone = false;

    document.getElementById('pdfOriginal').value = '';
    document.getElementById('pdfModified').value = '';
    document.getElementById('pdfOriginalName').textContent = '';
    document.getElementById('pdfModifiedName').textContent = '';

    const canvasOriginal = document.getElementById('pdfCanvasOriginal');
    const canvasModified = document.getElementById('pdfCanvasModified');
    canvasOriginal.getContext('2d').clearRect(0, 0, canvasOriginal.width, canvasOriginal.height);
    canvasModified.getContext('2d').clearRect(0, 0, canvasModified.width, canvasModified.height);
    canvasOriginal.width = 0;
    canvasOriginal.height = 0;
    canvasModified.width = 0;
    canvasModified.height = 0;

    document.getElementById('annotationOriginal').innerHTML = '';
    document.getElementById('annotationModified').innerHTML = '';

    document.getElementById('pdfNavigation').style.display = 'none';
    document.getElementById('pdfStatsContainer').style.display = 'none';
    updatePageInfo();
}

// ==================== Original Text Comparison Functions ====================

function getDiff(text1, text2) {
    // Use diffWordsWithSpace to find differences at the word level across the entire text.
    // This allows the algorithm to align paragraphs even if newlines are added or removed,
    // as it naturally synchronizes the rows whenever a newline is encountered in unchanged text.
    const diff = Diff.diffWordsWithSpace(text1, text2);

    const originalLines = [];
    const modifiedLines = [];
    let oRow = [], mRow = [];
    let removedCount = 0;
    let addedCount = 0;

    diff.forEach(part => {
        const value = part.value;
        const lines = value.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const val = lines[i];
            const escaped = escapeHtml(val);
            const isLast = (i === lines.length - 1);

            if (part.removed) {
                if (val) {
                    oRow.push(`<span class="removed">${escaped}</span>`);
                    removedCount++;
                }
                if (!isLast) {
                    // Newline in removed text: end of a row on the left.
                    // We flush the current row for both sides to maintain vertical alignment.
                    originalLines.push(oRow.join(''));
                    modifiedLines.push(mRow.join(''));
                    oRow = [];
                    mRow = [];
                }
            } else if (part.added) {
                if (val) {
                    mRow.push(`<span class="added">${escaped}</span>`);
                    addedCount++;
                }
                if (!isLast) {
                    // Newline in added text: end of a row on the right.
                    originalLines.push(oRow.join(''));
                    modifiedLines.push(mRow.join(''));
                    oRow = [];
                    mRow = [];
                }
            } else {
                if (val) {
                    oRow.push(escaped);
                    mRow.push(escaped);
                }
                if (!isLast) {
                    // Newline in unchanged text: synchronization point for both sides.
                    originalLines.push(oRow.join(''));
                    modifiedLines.push(mRow.join(''));
                    oRow = [];
                    mRow = [];
                }
            }
        }
    });

    // Flush any remaining text in the final row
    if (oRow.length > 0 || mRow.length > 0) {
        originalLines.push(oRow.join(''));
        modifiedLines.push(mRow.join(''));
    }

    const originalStats = getTextStats(text1);
    const modifiedStats = getTextStats(text2);

    return {
        originalHtml: originalLines.map((l, i) => `<div>${i + 1}: ${l}</div>`).join('\n'),
        modifiedHtml: modifiedLines.map((l, i) => `<div>${i + 1}: ${l}</div>`).join('\n'),
        stats: {
            originalStats,
            modifiedStats,
            removedCount,
            addedCount
        }
    };
}

function getTextStats(text) {
    const trimmed = text.trim();
    return {
        wordCount: trimmed ? trimmed.split(/\s+/).length : 0,
        charCount: text.length
    };
}

function escapeHtml(string) {
    const entityMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
    };

    return String(string).replace(/[&<>"'`=\/]/g, s => entityMap[s]);
}

function copyToClipboard(elementId) {
    const el = document.createElement('textarea');
    el.value = document.getElementById(elementId).innerText;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
}

function updateHeaderStats(stats) {
    const { originalStats, modifiedStats, removedCount = 0, addedCount = 0 } = stats || {};
    document.getElementById('originalWordCount').textContent = `Words: ${originalStats?.wordCount ?? 0}`;
    document.getElementById('originalCharCount').textContent = `Characters: ${originalStats?.charCount ?? 0}`;
    document.getElementById('originalDiffCount').textContent = `Removed: ${removedCount}`;
    document.getElementById('modifiedWordCount').textContent = `Words: ${modifiedStats?.wordCount ?? 0}`;
    document.getElementById('modifiedCharCount').textContent = `Characters: ${modifiedStats?.charCount ?? 0}`;
    document.getElementById('modifiedDiffCount').textContent = `Added: ${addedCount}`;
}

function resetHeaderStats() {
    document.getElementById('originalWordCount').textContent = 'Words: 0';
    document.getElementById('originalCharCount').textContent = 'Characters: 0';
    document.getElementById('originalDiffCount').textContent = 'Removed: 0';
    document.getElementById('modifiedWordCount').textContent = 'Words: 0';
    document.getElementById('modifiedCharCount').textContent = 'Characters: 0';
    document.getElementById('modifiedDiffCount').textContent = 'Added: 0';
}
