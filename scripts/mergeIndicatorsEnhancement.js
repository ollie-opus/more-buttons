export function mergeIndicatorsEnhancement () {
    const table = document.querySelector("table");
    if (!table) return;

    table.querySelectorAll("tbody tr").forEach(row => {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length === 0) return;

        // Get the trimmed text of the first cell
        const firstValue = cells[0].textContent.trim();

        // Check if all cells have the same trimmed text
        const allSame = cells.every(td => td.textContent.trim() === firstValue);

        const firstColumn = row.querySelector("th[scope='row']");
        if (firstColumn) {
            if (allSame) {
                firstColumn.style.color = "#047857";
                firstColumn.textContent = firstColumn.textContent.trim() + " ✅";
            } else {
                firstColumn.style.color = "#d69d0cff";
                firstColumn.textContent = firstColumn.textContent.trim() + " ⚠️";
            }
        }
    });
}
