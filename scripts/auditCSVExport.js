export function auditCSVExport() {
    // Select all <li> elements with both specific data attributes
    const questionBlocks = document.querySelectorAll('li[data-collapse-target="content"][data-reorderable-group="question"]');

    // Define CSV header
    let csvRows = [
        ['Section', 'Question', 'Weighting', 'Question Type', 'Audit Action Severity', 'Audit Action Title']
    ];

    questionBlocks.forEach(block => {
        const section_number = block.querySelector('input[name$="[section]"]')?.value || '';
        const section = document.getElementById(`section-${section_number}-name`)?.value || '';
        const question = block.querySelector('input[name$="[title]"]')?.value || '';
        const weighting = block.querySelector('input[name$="[weight]"]')?.value || '';
        const question_type = block.querySelector('input[name$="[type]"]')?.value || '';
        const audit_action_severity = block.querySelector('select[name$="[todo_severity]"]')?.value || '';
        const audit_action_title = block.querySelector('input[name$="[todo_title]"]')?.value || '';

        const row = [section, question, weighting, question_type, audit_action_severity, audit_action_title];

        // Audit Header (Other Information) exclusion rule
        if (section === "Other information") {
            return
        }

        // Only include the row if at least one field is not empty
        if (row.some(cell => cell.trim() !== '')) {
            csvRows.push(row);
        }
    });

    // Convert rows to CSV string
    const csvContent = csvRows
    .map(row => row.map(cell =>`"${cell.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""')}"`).join(',')).join('\n');


    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const rawTitle = document.getElementById('page-title')?.textContent.trim() || '';
    const cleanedTitle = rawTitle.replace(/^Edit\s+/i, '');
    link.href = URL.createObjectURL(blob);
    link.download = `${cleanedTitle} data-export.csv`;
    link.click();
}
