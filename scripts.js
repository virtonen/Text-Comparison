document.addEventListener('DOMContentLoaded', (event) => {
    document.getElementById('compareButton').addEventListener('click', () => {
        const text1 = document.getElementById('text1').value;
        const text2 = document.getElementById('text2').value;
        const outputOriginal = document.getElementById('outputOriginalContent');
        const outputModified = document.getElementById('outputModifiedContent');

        const diff = getDiff(text1, text2);
        outputOriginal.innerHTML = diff.original;
        outputModified.innerHTML = diff.modified;
    });

    document.getElementById('resetButton').addEventListener('click', () => {
        document.getElementById('text1').value = '';
        document.getElementById('text2').value = '';
        document.getElementById('outputOriginalContent').innerHTML = '';
        document.getElementById('outputModifiedContent').innerHTML = '';
    });
});

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

    const statsHeader = (stats, count, label) => `
        <div class="stats">
            <span>Words: ${stats.wordCount}</span>
            <span>Characters: ${stats.charCount}</span>
            <span>${label}: ${count}</span>
        </div>`;

    return {
        original: statsHeader(originalStats, removedCount, 'Removed') + 
                 originalLines.map((l, i) => `<div>${i + 1}: ${l}</div>`).join('\n'),
        modified: statsHeader(modifiedStats, addedCount, 'Added') + 
                 modifiedLines.map((l, i) => `<div>${i + 1}: ${l}</div>`).join('\n')
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
