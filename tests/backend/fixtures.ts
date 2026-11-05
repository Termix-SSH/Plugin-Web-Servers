export const STATUS = `os=Debian GNU/Linux 13 (trixie)
root=1
systemd=1
manager=apt-get
nginx=1.26.3
nginxlayout=debian
nginxstate=active
nginxboot=1
apache=2.4.62
apachelayout=debian
apachestate=inactive
caddy=2.6.2
caddystate=active
caddyboot=1
certbot=4.0.0
certbotnginx=1
php=/run/php/php8.4-fpm.sock
`;

export const NGINX_DEFAULT = `server {
	listen 80 default_server;
	listen [::]:80 default_server;
	# a comment with server_name fake.example;
	root /var/www/html;
	index index.html index.htm;
	server_name _;
	location / {
		try_files $uri $uri/ =404;
	}
}
`;

export const NGINX_APP = `server {
    listen 443 ssl;
    server_name app.example.com www.app.example.com;
    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;
    access_log /var/log/nginx/app.access.log;
    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
`;

export const APACHE_SITE = `<VirtualHost *:80>
    ServerName blog.example.com
    ServerAlias www.blog.example.com
    DocumentRoot "/var/www/blog"
    ErrorLog /var/log/apache2/blog.error.log
    CustomLog /var/log/apache2/blog.access.log combined
</VirtualHost>
`;

export const CADDY_SITE = `files.example.com, http://files.local:8080 {
    root * /srv/files
    file_server
    log {
        output file /var/log/caddy/files.access.log
    }
}
`;

export const LIST = `@@WS@@FILE nginx|1|/etc/nginx/sites-available/default
${NGINX_DEFAULT}
@@WS@@END
@@WS@@FILE nginx|0|/etc/nginx/sites-available/app.conf
${NGINX_APP}
@@WS@@END
@@WS@@FILE apache|1|/etc/apache2/sites-available/blog.conf
${APACHE_SITE}
@@WS@@END
@@WS@@FILE caddy|1|/etc/caddy/sites/files.caddy
${CADDY_SITE}
@@WS@@END
@@WS@@CERT /etc/letsencrypt/live/app.example.com/fullchain.pem|Dec  1 10:00:00 2026 GMT
`;

export const ACCESS_LOG = [
  '10.0.0.1 - - [05/Nov/2026:10:00:00 +0000] "GET / HTTP/1.1" 200 612 "-" "curl/8"',
  '10.0.0.1 - - [05/Nov/2026:10:00:01 +0000] "GET /about?x=1 HTTP/1.1" 200 100 "-" "curl/8"',
  '10.0.0.2 - - [05/Nov/2026:10:00:02 +0000] "POST /login HTTP/1.1" 302 0 "-" "Mozilla"',
  '10.0.0.3 - - [05/Nov/2026:10:00:03 +0000] "GET /missing HTTP/1.1" 404 10 "-" "Mozilla"',
  '10.0.0.3 - - [05/Nov/2026:10:00:04 +0000] "GET / HTTP/1.1" 502 10 "-" "Mozilla"',
  '{"level":"info","request":{"remote_ip":"10.0.0.9","uri":"/x"},"status":200}',
  "2026/11/05 10:00:00 [error] 12#12: something broke",
];
