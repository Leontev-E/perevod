<?php
  session_start();
  $phone = "+7 900 000-00-00";
  $price = 1990;
  require_once __DIR__ . '/config.php';
?>
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Крем «Здоровье суставов» — скидка 50%</title>
  <meta name="description" content="Купите крем со скидкой 50% всего за 1990 рублей в Москве">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="topbar">
    <a class="logo" href="/">Здоровье суставов</a>
    <span class="phone"><?= $phone ?></span>
  </header>

  <section class="hero">
    <h1 class="hero__title">Крем «Здоровье суставов» от боли</h1>
    <p class="hero__lead">Закажите сегодня в Москве со скидкой <strong>50%</strong>!</p>
    <div class="price">
      <span class="price__old">3980 руб.</span>
      <span class="price__new"><?php echo $price; ?> руб.</span>
    </div>
    <button class="btn btn--buy" data-goal="order" type="button">Заказать со скидкой</button>
  </section>

  <section class="reviews">
    <h2>Отзывы покупателей</h2>
    <div id="reviews-list"></div>
  </section>

  <form class="order-form" action="api.php" method="post">
    <input type="hidden" name="offer" value="joint-cream">
    <input type="text" name="name" placeholder="Ваше имя" required>
    <input type="tel" name="phone" placeholder="Ваш телефон" required>
    <input type="submit" value="Купить за 1990 руб.">
  </form>

  <img src="img/banner.png" alt="Скидка 50% на крем">

  <script src="js/app.js"></script>
  <script>
    var reviews = ["Отличный крем, помог за неделю!", "Заказывала маме в Москве, довольна."];
    document.querySelector('.btn--buy').addEventListener('click', function () {
      alert('Спасибо за заказ!');
    });
  </script>
</body>
</html>
