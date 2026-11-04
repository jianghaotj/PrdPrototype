function showPage(id) {
  document.querySelectorAll('.page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + id); });
  document.querySelectorAll('.menu-item').forEach(function (m) { m.classList.toggle('active', m.id === 'nav-' + id); });
}
function openModal() { document.getElementById('modal-new').classList.add('show'); }
function closeModal() { document.getElementById('modal-new').classList.remove('show'); }
document.getElementById('kpi-follow').addEventListener('click', function () { showPage('customers'); });
