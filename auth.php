<?php
declare(strict_types=1);

const AUTH_SESSION_NAME = 'chili_finance_session';
const AUTH_IDLE_SECONDS = 8 * 60 * 60;
const AUTH_MAX_ATTEMPTS = 5;
const AUTH_LOCK_SECONDS = 5 * 60;

function auth_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

    session_name(AUTH_SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.use_strict_mode', '1');
    session_start();
}

function auth_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $config = require __DIR__ . '/config.php';
    $db = $config['db'];
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $db['host'], $db['port'] ?? 3306, $db['name']);

    $pdo = new PDO($dsn, $db['user'], $db['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

/** @return array{id:int,email:string,name:string,password_hash:string}|null */
function auth_find_user(string $email): ?array
{
    $email = strtolower(trim($email));
    if ($email === '') {
        return null;
    }
    $select = auth_db()->prepare(
        'SELECT id, email, name, password_hash
           FROM dashboard_users
          WHERE email = ? AND is_active = 1
          LIMIT 1'
    );
    $select->execute([$email]);
    $row = $select->fetch();
    if (!is_array($row)) {
        return null;
    }
    $row['id'] = (int) $row['id'];
    return $row;
}

function auth_verify_password(?array $user, string $password): bool
{
    if ($user === null) {
        password_hash($password, PASSWORD_DEFAULT);
        return false;
    }
    return password_verify($password, $user['password_hash']);
}

function auth_after_login(array $user, string $password): void
{
    try {
        $pdo = auth_db();
        if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
            $pdo->prepare('UPDATE dashboard_users SET password_hash = ? WHERE id = ?')
                ->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
        }
        $pdo->prepare('UPDATE dashboard_users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?')
            ->execute([$user['id']]);
    } catch (Throwable $error) {
        error_log('[auth] post-login update: ' . $error->getMessage());
    }
}

function auth_user(): ?array
{
    auth_start();
    $user = $_SESSION['auth_user'] ?? null;
    if (!is_array($user)) {
        return null;
    }
    $last = (int) ($_SESSION['auth_last_seen'] ?? 0);
    if (time() - $last > AUTH_IDLE_SECONDS) {
        auth_logout();
        return null;
    }
    $_SESSION['auth_last_seen'] = time();
    return $user;
}

function auth_attempt(string $email, string $password): ?string
{
    auth_start();
    $lockedUntil = (int) ($_SESSION['auth_locked_until'] ?? 0);
    if ($lockedUntil > time()) {
        $minutes = (int) ceil(($lockedUntil - time()) / 60);
        return "Too many attempts. Try again in {$minutes} minute" . ($minutes === 1 ? '' : 's') . '.';
    }

    try {
        $user = auth_find_user($email);
    } catch (Throwable $error) {
        error_log('[auth] ' . $error->getMessage());
        return 'We couldn’t check your account right now. Try again in a moment.';
    }
    $valid = auth_verify_password($user, $password);

    if (!$valid) {
        $attempts = (int) ($_SESSION['auth_attempts'] ?? 0) + 1;
        $_SESSION['auth_attempts'] = $attempts;
        if ($attempts >= AUTH_MAX_ATTEMPTS) {
            $_SESSION['auth_attempts'] = 0;
            $_SESSION['auth_locked_until'] = time() + AUTH_LOCK_SECONDS;
        }
        return 'That email and password don’t match.';
    }

    session_regenerate_id(true);
    unset($_SESSION['auth_attempts'], $_SESSION['auth_locked_until']);
    $_SESSION['auth_user'] = ['id' => $user['id'], 'email' => $user['email'], 'name' => $user['name']];
    $_SESSION['auth_last_seen'] = time();
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    auth_after_login($user, $password);
    return null;
}

function auth_logout(): void
{
    auth_start();
    $_SESSION = [];
    $params = session_get_cookie_params();
    setcookie(session_name(), '', [
        'expires' => time() - 3600,
        'path' => $params['path'],
        'secure' => $params['secure'],
        'httponly' => $params['httponly'],
        'samesite' => $params['samesite'] ?: 'Lax',
    ]);
    session_destroy();
}

function auth_csrf_token(): string
{
    auth_start();
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function auth_check_csrf(?string $token): bool
{
    auth_start();
    return is_string($token) && !empty($_SESSION['csrf_token']) && hash_equals($_SESSION['csrf_token'], $token);
}

function auth_require_page(): array
{
    $user = auth_user();
    if ($user === null) {
        header('Location: login.php', true, 302);
        exit;
    }
    auth_csrf_token();
    session_write_close();
    return $user;
}

function auth_require_api(): array
{
    $user = auth_user();
    if ($user === null) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode(['error' => 'Your session has ended. Sign in again.', 'auth' => false]);
        exit;
    }
    session_write_close();
    return $user;
}
