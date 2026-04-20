export function setAnnualDocumentDefault() {
    document.getElementById('document_scope').value = 'device';
    document.getElementById('document_measurement_reminder_severity').value = 'minor';
    document.getElementById('document_measurement_reminder_interval').value = 'P1Y';
    document.getElementById('document_measurement_reminder_lead_time').value = 'P14D';
}
