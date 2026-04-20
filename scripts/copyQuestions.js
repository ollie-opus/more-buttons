export function copyQuestions() {
    // open the details element
    document.querySelector('details[aria-labelledby="questions-section-title"]').open = true;

    //open potential sections
    document.querySelectorAll('button[data-collapse-target="trigger"][aria-expanded="false"]').forEach(button => {
        button.click();
    });

    // Get the page title
    const titleElement = document.querySelector('#page-title');
    let pageTitle = titleElement ? titleElement.innerText.trim() : "Untitled";

    // Check for "Checklist:" or "Audit:" prefix
    if (/^Checklist:/i.test(pageTitle) || /^Audit:/i.test(pageTitle)) {
        pageTitle += " questions";
    }
    // Check for "Playbook:" prefix
    else if (/^Playbook:/i.test(pageTitle)) {
        pageTitle += " steps";
    }
    // Select the specific table with class "0"
    const table = document.querySelector('table.\\30');
    if (!table) {
        alert("Table not found.");
        return;
    }

    const rows = table.querySelectorAll("tr");
    const questions = [];

    rows.forEach(row => {
        const cells = row.querySelectorAll("td");
        if (cells.length > 0) {
            const questionText = cells[0].innerText.trim();
            if (questionText) {
                questions.push([questionText]);
            }
        }
    });

    // Prepend the modified title
    const allLines = [[pageTitle], ...questions];
    const tsv = allLines.map(line => line.join("\t")).join("\n");

    navigator.clipboard.writeText(tsv)
        .then(() => alert('Checklist/Audit/Playbook questions/steps copied to clipboard!'))
        .catch(err => console.error('Failed to copy data:', err));
}
