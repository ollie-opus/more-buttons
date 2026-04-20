import { createForm } from './form.js';

export async function bulkRevisionDownload(mode = 'file') {
  if (mode !== 'file' && mode !== 'zip') {
    console.error('bulkRevisionDownload: mode must be "file" or "zip". Got:', mode);
    alert('bulkRevisionDownload: mode must be "file" or "zip".');
    return;
  }

  // Pull libs from globals (set by scripts/libs/*.js)
  const pdfLib   = window.PDFLib || null;
  const JSZipLib = window.JSZip || null;

  // ---------- Helpers ----------

  function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]+/g, '_').trim();
  }

  function formatDocDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d)) return iso;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`; // dd-mm-yyyy
  }

  // Strip any existing opus_metadata block from a "base" name
  function stripOpusMetadata(base) {
    if (!base) return base;
    const metaMarker = ' opus_metadata={';
    const idx = base.indexOf(metaMarker);
    if (idx === -1) return base.trim();
    return base.slice(0, idx).trim();
  }

  function buildFileInfoFromLink(link) {
    const row = link.closest('tr');
    if (!row) return null;

    const cells = row.querySelectorAll('td');

    // 0: icon, 1: submission date, 2: submitted by, 3: document date
    const submissionTimeEl = cells[1]?.querySelector('time');
    const submittedByCell  = cells[2];
    const documentTimeEl   = cells[3]?.querySelector('time');

    const submissionISO =
      submissionTimeEl?.getAttribute('datetime')?.trim() || '';
    const documentISO =
      documentTimeEl?.getAttribute('datetime')?.trim() || '';
    const submittedBy =
      (submittedByCell?.textContent || '').trim() || 'unknown';

    const docIsoDateOnly = documentISO ? documentISO.split('T')[0] : '';
    const docDateKey = docIsoDateOnly || 'unknown';
    const docDateFormatted = formatDocDate(documentISO) || 'unknown';

    const url = new URL(link.href, window.location.href);
    const lastSegment = url.pathname.split('/').pop() || '';
    let fullFileName = decodeURIComponent(lastSegment);

    // Collapse "<name>.<ext>.<name>.<ext>" pattern generically
    // e.g. "foo.pdf.foo.pdf" or "bar.docx.bar.docx" → "foo.pdf" / "bar.docx"
    const dupMatch = fullFileName.match(/^(.*\.[^.]+)\.\1$/);
    if (dupMatch) {
      fullFileName = dupMatch[1];
    }

    // Split into base + ext by LAST dot
    let base, ext;
    const lastDot = fullFileName.lastIndexOf('.');
    if (lastDot > 0) {
      base = fullFileName.slice(0, lastDot);
      ext  = fullFileName.slice(lastDot); // includes dot, e.g. ".pdf", ".docx"
    } else {
      base = fullFileName;
      ext  = '';
    }

    // First-pass strip (in case server name already contains opus_metadata)
    base = stripOpusMetadata(base);

    return {
      url: url.toString(),
      originalBase: base,  // cleaned base, without any prior opus_metadata
      ext,
      submissionISO,
      submittedBy,
      documentISO,
      docDateKey,
      docDateFormatted,
    };
  }

  function groupByDocDate(files) {
    const map = new Map();
    for (const f of files) {
      const key = f.docDateKey || 'unknown';
      if (!map.has(key)) {
        map.set(key, {
          docDateKey: key,
          docDateFormatted: f.docDateFormatted,
          files: [],
        });
      }
      map.get(key).files.push(f);
    }
    return Array.from(map.values());
  }

  // Use your createForm + HTML form for the merge prompt (only for PDFs)
  async function showMergePrompt(candidateGroups) {
    // 1) Create the overlay + inject HTML from config/forms/mergeRevisions.html
    await createForm('mergeRevisions');

    // 2) Grab elements we want to populate
    const summaryEl = document.getElementById('merge-candidates-summary');
    const detailEl  = document.getElementById('merge-candidates-detail');

    if (summaryEl) {
      const datesCount = candidateGroups.length;
      const filesCount = candidateGroups.reduce((sum, g) => sum + g.files.length, 0);
      summaryEl.textContent =
        `${datesCount} document date${datesCount !== 1 ? 's' : ''} with ` +
        `${filesCount} PDF revision file${filesCount !== 1 ? 's' : ''}.`;
    }

    if (detailEl) {
      detailEl.innerHTML = '';
      candidateGroups.forEach(group => {
        const wrapper = document.createElement('div');
        wrapper.className = 'merge-candidate-group';

        const dateLabel = document.createElement('div');
        dateLabel.className = 'merge-candidate-date';
        const dateText =
          group.docDateFormatted && group.docDateFormatted !== 'unknown'
            ? group.docDateFormatted
            : 'Unknown date';
        dateLabel.textContent =
          `Document date: ${dateText} (${group.files.length} file` +
          `${group.files.length !== 1 ? 's' : ''})`;

        const ul = document.createElement('ul');
        ul.className = 'merge-candidate-files';

        group.files.forEach(f => {
          const li = document.createElement('li');
          li.textContent =
            `${f.originalBase} (submitted_by=${f.submittedBy || 'unknown'})`;
          ul.appendChild(li);
        });

        wrapper.appendChild(dateLabel);
        wrapper.appendChild(ul);
        detailEl.appendChild(wrapper);
      });
    }

    // 3) Wait for user to click "Merge revisions" or "Keep separate"
    return new Promise(resolve => {
      const mergeBtn = document.getElementById('mb-merge-confirm');
      const sepBtn   = document.getElementById('mb-merge-cancel');

      const cleanup = (value) => {
        const currentOverlay = document.querySelector('.more-buttons-overlay');
        if (currentOverlay) currentOverlay.remove();
        resolve(value); // true = merge, false = keep separate
      };

      if (mergeBtn) {
        mergeBtn.addEventListener('click', () => cleanup(true), { once: true });
      }
      if (sepBtn) {
        sepBtn.addEventListener('click', () => cleanup(false), { once: true });
      }
    });
  }

  // ---------- Main logic ----------

  const downloadLinks = Array.from(
    document.querySelectorAll('table tbody tr a[href*="disposition=attachment"]')
  );

  if (!downloadLinks.length) {
    console.warn('bulkRevisionDownload: No download links with disposition=attachment found.');
    alert('No downloadable revision files found on this page.');
    return;
  }

  const files = downloadLinks
    .map(buildFileInfoFromLink)
    .filter(Boolean);

  if (!files.length) {
    console.warn('bulkRevisionDownload: No valid files found to download.');
    alert('No valid files found to download.');
    return;
  }

  console.log(`bulkRevisionDownload: Fetching ${files.length} files...`);

  // Fetch all once
  for (const file of files) {
    try {
      const response = await fetch(file.url, { credentials: 'same-origin' });
      if (!response.ok) {
        console.error('Failed to fetch', file.url, response.status);
        continue;
      }
      file.arrayBuffer = await response.arrayBuffer();
    } catch (e) {
      console.error('Error fetching', file.url, e);
    }
  }

  const validFiles = files.filter(f => f.arrayBuffer);
  if (!validFiles.length) {
    console.error('bulkRevisionDownload: All fetches failed; nothing to download.');
    alert('All file fetches failed; nothing to download.');
    return;
  }

  // Separate PDFs vs non-PDFs
  const pdfFiles    = validFiles.filter(f => f.ext.toLowerCase() === '.pdf');
  const nonPdfFiles = validFiles.filter(f => f.ext.toLowerCase() !== '.pdf');

  // Only PDFs participate in merging logic
  const pdfGroups       = groupByDocDate(pdfFiles);
  const candidateGroups = pdfGroups.filter(g => g.files.length > 1);

  let mergeEnabled = false;
  if (candidateGroups.length > 0) {
    const userChoice = await showMergePrompt(candidateGroups);
    mergeEnabled = !!userChoice;

    if (mergeEnabled) {
      if (!pdfLib) {
        alert(
          'Merging by document date was selected, but pdf-lib is not loaded.\n' +
          'Make sure pdf-lib.min.js is included before actions.js.'
        );
        mergeEnabled = false;
      } else {
        console.log('bulkRevisionDownload: User chose to merge PDF files by document date.');
      }
    } else {
      console.log('bulkRevisionDownload: User chose to keep all files separate.');
    }
  } else {
    console.log('bulkRevisionDownload: No PDF merge candidates (no document date has multiple PDFs).');
  }

  // For zip mode, we must have JSZip
  if (mode === 'zip' && !JSZipLib) {
    alert(
      'ZIP mode selected, but JSZip is not loaded.\n' +
      'Make sure jszip.min.js is included before actions.js.'
    );
    mode = 'file';
  }

  const outputs = [];

  // pdf-lib handling: allow either namespace or direct class
  let PDFDocument = null;
  if (mergeEnabled && pdfLib) {
    PDFDocument = pdfLib.PDFDocument || pdfLib;
  }

  // Helper: build final filename with *one* metadata block
  function buildFinalName(file, extraMetaParts = []) {
    // Clean any stray metadata that might have slipped through
    let base = stripOpusMetadata(file.originalBase);

    const ddmmyyyy = file.docDateFormatted || 'unknown';
    const safeSubmittedBy  = (file.submittedBy || 'unknown').replace(/\s+/g, '_');
    const safeSubmissionISO =
      (file.submissionISO || 'unknown').replace(/:/g, '_');

    const metaPieces = [
      `_document_date_${ddmmyyyy}_`,
      `_submitted_by_${safeSubmittedBy}_`,
      `_original_submission_date_${safeSubmissionISO}_`,
      ...extraMetaParts // e.g. `_merged_count_3_`
    ].filter(Boolean);

    const metaString = ` opus_metadata={${metaPieces.join(',')}}`;

    let newFileName = `${base}${metaString}${file.ext}`;
    newFileName = sanitizeFilename(newFileName);
    return newFileName;
  }

  if (!mergeEnabled) {
    // ---------- No merging: one file per revision (PDF and non-PDF) ----------
    for (const f of validFiles) {
      const filename = buildFinalName(f);
      outputs.push({
        filename,
        arrayBuffer: f.arrayBuffer,
      });
    }
  } else {
    // ---------- Merging: PDFs by document date; non-PDFs always separate ----------

    // 1) Always add non-PDF files individually (never merged)
    for (const f of nonPdfFiles) {
      const filename = buildFinalName(f);
      outputs.push({
        filename,
        arrayBuffer: f.arrayBuffer,
      });
    }

    // 2) Handle PDFs — some merged, some not
    for (const group of pdfGroups) {
      const { docDateFormatted, files: groupFiles } = group;
      const ddmmyyyy = docDateFormatted || 'unknown';

      if (groupFiles.length === 1) {
        // Just one PDF for that date, treat as normal (like non-merged case)
        const f = groupFiles[0];
        const filename = buildFinalName(f);
        outputs.push({
          filename,
          arrayBuffer: f.arrayBuffer,
        });
      } else {
        // Merge all PDFs for this document date
        console.log(
          `bulkRevisionDownload: Merging ${groupFiles.length} PDFs for document date ${ddmmyyyy}...`
        );

        try {
          const mergedPdf = await PDFDocument.create();

          for (const f of groupFiles) {
            try {
              const srcDoc = await PDFDocument.load(f.arrayBuffer);
              const srcPages = await mergedPdf.copyPages(
                srcDoc,
                srcDoc.getPageIndices()
              );
              srcPages.forEach(p => mergedPdf.addPage(p));
            } catch (e) {
              console.error('Error merging one of the PDFs for date', ddmmyyyy, e);
            }
          }

          const mergedBytes = await mergedPdf.save();
          const mergedCount = groupFiles.length;

          // collect all unique submitter names for this merged group
          const uniqueSubmitters = Array.from(
            new Set(
              groupFiles.map(f =>
                (f.submittedBy || 'unknown').trim()
              )
            )
          );
          let safeSubmitters = uniqueSubmitters
            .map(name => name.replace(/\s+/g, '_'))
            .join('+');
          if (!safeSubmitters) safeSubmitters = 'unknown';

          const mergedMetaPieces = [
            `_document_date_${ddmmyyyy}_`,
            `_merged_count_${mergedCount}_`,
            `_submitted_by_${safeSubmitters}_`
          ];

          const metaString = ` opus_metadata={${mergedMetaPieces.join(',')}}`;
          let mergedName = `merged_${ddmmyyyy}${metaString}.pdf`;
          mergedName = sanitizeFilename(mergedName);

          outputs.push({
            filename: mergedName,
            arrayBuffer: mergedBytes.buffer, // Uint8Array -> ArrayBuffer
          });
        } catch (e) {
          console.error('Failed to merge PDF group for date', ddmmyyyy, e);
          alert(
            `Failed to merge PDFs for document date ${ddmmyyyy}.\n` +
            'Those files may be skipped or partially merged.'
          );
        }
      }
    }
  }

  if (!outputs.length) {
    console.error('bulkRevisionDownload: No outputs were created.');
    alert('No files were prepared for download (something went wrong).');
    return;
  }

  // ---------- Deliver outputs ----------

  if (mode === 'file') {
    console.log(`bulkRevisionDownload: Downloading ${outputs.length} files...`);
    for (const out of outputs) {
      console.log('Downloading:', out.filename);
      const blob = new Blob([out.arrayBuffer], { type: 'application/octet-stream' });
      const blobUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = out.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    }
    console.log('bulkRevisionDownload: Done queuing downloads (browser may ask to allow multiple downloads).');
    return;
  }

  if (mode === 'zip') {
    console.log(`bulkRevisionDownload: Adding ${outputs.length} files to ZIP...`);
    const zip = new JSZipLib();

    for (const out of outputs) {
      zip.file(out.filename, out.arrayBuffer);
    }

    console.log('bulkRevisionDownload: Generating ZIP...');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(zipBlob);

    const a = document.createElement('a');
    a.href = zipUrl;
    a.download = 'opus_documents_merged_by_date.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(zipUrl);

    console.log('bulkRevisionDownload: ZIP download triggered: opus_documents_merged_by_date.zip');
  }
}
