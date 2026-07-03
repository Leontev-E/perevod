(function () {
  var el = document.getElementById('reviews-list');
  var items = [
    { author: 'Ирина', text: 'Крем реально работает, боль ушла.' },
    { author: 'Сергей', text: 'Заказал отцу, спасибо за скидку!' }
  ];
  var html = '';
  items.forEach(function (r) {
    html += '<div class="review"><b>' + r.author + '</b>: ' + r.text + '</div>';
  });
  el.className = 'reviews-grid';
  el.innerHTML = html;
  var currency = 'руб.';
  console.log('reviews loaded');
})();
