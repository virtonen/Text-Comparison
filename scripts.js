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
    // 1. Use diffLines to align blocks of text (LCS algorithm).
    // ignoreWhitespace: true helps align paragraphs even if they have different trailing spaces or line breaks.
    const diff = Diff.diffLines(text1, text2, { ignoreWhitespace: true });

    const originalLines = [];
    const modifiedLines = [];
    let removedCount = 0;
    let addedCount = 0;

    // 2. Process the diff results into aligned rows for the side-by-side view
    for (let i = 0; i < diff.length; i++) {
        const part = diff[i];
        const nextPart = diff[i + 1];

        // "Change" detection: If a removal is immediately followed by an addition,
        // we treat it as a modification and perform a word-level diff for inline highlights.
        if (part.removed && nextPart && nextPart.added) {
            const wordDiff = Diff.diffWordsWithSpace(part.value, nextPart.value);
            let oBlock = '', mBlock = '';

            wordDiff.forEach(wp => {
                const val = escapeHtml(wp.value);
                if (wp.removed) {
                    oBlock += `<span class="removed">${val}</span>`;
                    removedCount++;
                } else if (wp.added) {
                    mBlock += `<span class="added">${val}</span>`;
                    addedCount++;
                } else {
                    oBlock += val;
                    mBlock += val;
                }
            });

            const oLines = oBlock.split('\n');
            const mLines = mBlock.split('\n');
            const max = Math.max(oLines.length, mLines.length);

            for (let j = 0; j < max; j++) {
                originalLines.push(oLines[j] || '');
                modifiedLines.push(mLines[j] || '');
            }
            i++; // Skip the 'added' part as we just processed it
        } 
        else if (part.removed) {
            const lines = part.value.split('\n');
            if (lines[lines.length - 1] === '' && part.value.length > 0) lines.pop();
            lines.forEach(l => {
                originalLines.push(`<span class="removed">${escapeHtml(l)}</span>`);
                modifiedLines.push(''); // Alignment placeholder
                removedCount++;
            });
        } 
        else if (part.added) {
            const lines = part.value.split('\n');
            if (lines[lines.length - 1] === '' && part.value.length > 0) lines.pop();
            lines.forEach(l => {
                originalLines.push(''); // Alignment placeholder
                modifiedLines.push(`<span class="added">${escapeHtml(l)}</span>`);
                addedCount++;
            });
        } 
        else {
            const lines = part.value.split('\n');
            if (lines[lines.length - 1] === '' && part.value.length > 0) lines.pop();
            lines.forEach(l => {
                const escaped = escapeHtml(l);
                originalLines.push(escaped);
                modifiedLines.push(escaped);
            });
        }
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
    return {
        wordCount: text.trim().split(/\s+/).length,
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
