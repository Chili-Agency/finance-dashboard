<?php
declare(strict_types=1);
require __DIR__ . '/auth.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST' || !auth_check_csrf($_POST['csrf'] ?? null)) {
    header('Location: index.php', true, 303);
    exit;
}

auth_logout();
header('Location: login.php?signed_out=1', true, 303);
exit;