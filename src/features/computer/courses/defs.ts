/**
 * 컴퓨터 일반과 같은 구조(단원 × 5단계 · 모의고사 · 오답노트)로 만드는 새 과목들(2026-10-26).
 * 내용은 courses/<과목>/U1~U8.json(원본 형식은 컴퓨터 일반 pc_bank.json 단원과 같고,
 * 이론 카드에 개념 맞추기 match·선택 code, 문항에 선택 code가 더 있다).
 */
export type NewCourseId = 'net' | 'prog' | 'data';

export interface CourseUnitPlan {
  num: number;
  title: string;
  /** 다뤄야 할 범위(작성 지침) */
  scope: string;
  /** 이 단원 문항의 주 영역 */
  areas: string[];
}

export interface NewCourseDef {
  id: NewCourseId;
  /** 첫 화면 과목 이름(자격증 이름은 쓰지 않음) */
  name: string;
  path: string;
  /** 내용 범위 출처(안내용) */
  basis: string;
  summary: string;
  areas: { id: string; label: string }[];
  units: CourseUnitPlan[];
}

export const NEW_COURSES: NewCourseDef[] = [
  {
    id: 'net', name: '네트워크', path: '/network',
    basis: '네트워크관리사 2급(네트워크 일반·TCP/IP·NOS·네트워크 운용기기)과 정보기기운용기능사(네트워크 구성·정보기기 설치운영·유지보수) 필기 범위',
    summary: '네트워크 기초와 OSI 7계층부터 IP 주소·프로토콜, 장비·케이블, 서버 운영과 유지보수까지 8단원을 단계별로 익히고 모의고사로 점검해요.',
    areas: [
      { id: 'GEN', label: '네트워크 일반' }, { id: 'TCP', label: 'TCP/IP' }, { id: 'NOS', label: '네트워크 운영체제' },
      { id: 'DEV', label: '네트워크 기기·매체' }, { id: 'OPS', label: '정보기기 설치·유지보수' },
    ],
    units: [
      { num: 1, title: '네트워크 기초와 OSI 7계층', areas: ['GEN'], scope: 'LAN·MAN·WAN, 토폴로지(버스·스타·링·메시·트리), OSI 7계층과 계층별 역할·장비·PDU, TCP/IP 4계층과 대응, 캡슐화·역캡슐화, 연결형·비연결형, 프로토콜의 3요소' },
      { num: 2, title: '데이터 통신 기술', areas: ['GEN'], scope: '전송 방향(단방향·반이중·전이중), 직렬·병렬, 동기·비동기, 아날로그·디지털 신호와 변조(ASK·FSK·PSK·QAM, PCM), 다중화(FDM·TDM·WDM·CDM), 오류 검출·정정(패리티·CRC·해밍 코드·ARQ), 흐름 제어(정지-대기·슬라이딩 윈도우), 교환 방식(회선·패킷·메시지), WAN 기술(전용회선·X.25·프레임 릴레이·ATM·MPLS·xDSL·FTTH), HDLC·PPP' },
      { num: 3, title: 'IP 주소와 서브네팅', areas: ['TCP'], scope: 'IPv4 구조·클래스(A~E), 네트워크·호스트 부분, 사설 IP 대역, 특수 주소(루프백·브로드캐스트·0.0.0.0·APIPA), 서브넷 마스크, 서브네팅 계산(서브넷 수·호스트 수·네트워크/브로드캐스트 주소), CIDR 표기, NAT·PAT, IPv6 표기·축약·주소 종류(유니·멀티·애니캐스트)·전환 기술(듀얼 스택·터널링·변환)' },
      { num: 4, title: 'TCP/IP 프로토콜', areas: ['TCP'], scope: 'IP 헤더(TTL·단편화), ARP·RARP, ICMP(ping·tracert), IGMP, TCP(3-way handshake·4-way 종료·흐름·혼잡 제어·플래그), UDP, 잘 알려진 포트 번호, 응용 프로토콜(DNS·DHCP·HTTP/HTTPS·FTP·SMTP·POP3·IMAP·Telnet·SSH·SNMP·NTP), 라우팅 프로토콜(정적·동적, RIP·OSPF·BGP, 거리 벡터·링크 상태)' },
      { num: 5, title: '네트워크 장비와 VLAN', areas: ['DEV'], scope: 'NIC와 MAC 주소, 리피터·허브·브리지·스위치·라우터·게이트웨이의 계층과 역할, L2~L7 스위치, 충돌 도메인·브로드캐스트 도메인, 스위칭 방식, VLAN(포트·MAC 기반, 802.1Q 태깅, 트렁크), STP, 이중화·부하 분산, 저장장치(RAID 0·1·5·10, NAS·SAN), UPS, 무선 AP' },
      { num: 6, title: '전송 매체와 LAN 표준', areas: ['DEV'], scope: 'UTP·STP·FTP 케이블과 카테고리, RJ-45와 T568A·T568B, 다이렉트·크로스 케이블, 동축 케이블, 광섬유(싱글·멀티모드)와 장점, 이더넷 표준 이름 읽기(10BASE-T·100BASE-TX·1000BASE-T·1000BASE-SX 등), CSMA/CD, IEEE 802.3, 무선 LAN IEEE 802.11 a/b/g/n/ac/ax와 CSMA/CA, 무선 보안(WEP·WPA2·WPA3), 블루투스' },
      { num: 7, title: 'Windows Server 운영', areas: ['NOS', 'OPS'], scope: '서버 역할(파일·프린터 공유, IIS 웹·FTP, DNS, DHCP, Hyper-V, 원격 데스크톱), Active Directory(도메인·트리·포리스트·OU·도메인 컨트롤러·그룹 정책), 사용자·그룹 관리, NTFS 권한과 공유 권한, 암호·계정 잠금 정책, 이벤트 뷰어·성능 모니터·작업 관리자, 디스크 관리(기본·동적 디스크, 단순·스팬·스트라이프·미러·RAID-5 볼륨), 레지스트리, PowerShell 기초, 네트워크 명령(ipconfig·ping·tracert·nslookup·netstat·arp)' },
      { num: 8, title: 'Linux 서버와 정보기기 유지보수', areas: ['NOS', 'OPS'], scope: 'Linux 디렉터리 구조(/etc·/home·/var·/root 등), 파일·디렉터리 명령(ls·cd·cp·mv·rm·mkdir·cat·grep·find), 권한(rwx, chmod 숫자·기호, chown, umask), 사용자 관리(useradd·passwd·/etc/passwd·/etc/shadow), 프로세스(ps·kill·top), 네트워크 설정(ip·ifconfig·/etc/resolv.conf·systemctl), 서비스(Apache·Samba·SSH); 정보기기 설치·유지보수: 장애 진단 순서(물리→논리), 케이블 테스터, 백업(전체·증분·차등), 펌웨어·드라이버 업데이트, 정전기·접지 안전' },
    ],
  },
  {
    id: 'prog', name: '프로그래밍', path: '/programming',
    basis: 'COS Pro 2급(파이썬) 범위: 기초 문법·제어 구조·리스트·문자열·함수와 간단한 문제 해결, 시험 유형(빈칸 채우기·한 줄 수정·함수 작성)',
    summary: '파이썬으로 변수·조건·반복부터 리스트·문자열·함수, 간단한 알고리즘까지 8단원을 단계별로 익히고, 코드를 읽고 고치는 문제로 점검해요.',
    areas: [
      { id: 'BASIC', label: '기초 문법' }, { id: 'CTRL', label: '제어 구조' }, { id: 'DS', label: '자료 구조' },
      { id: 'FUNC', label: '함수' }, { id: 'ALGO', label: '알고리즘·문제 해결' },
    ],
    units: [
      { num: 1, title: '변수·자료형과 입출력', areas: ['BASIC'], scope: 'print·input, 변수와 이름 규칙, 자료형(int·float·str·bool)과 type(), 형변환(int·float·str), 문자열 연결과 f-string, 주석, 들여쓰기의 의미' },
      { num: 2, title: '연산자와 식', areas: ['BASIC'], scope: '산술 연산자(+ - * / // % **), 정수 나눗셈과 나머지 활용(짝홀·자릿수·배수), 비교 연산자, 논리 연산자(and·or·not), 복합 대입(+= 등), 연산자 우선순위, 문자열 연산(+ *)' },
      { num: 3, title: '조건문', areas: ['CTRL'], scope: 'if·elif·else, 조건식과 들여쓰기, 중첩 조건, 범위 판정(a <= x < b), 논리 연산과 조건, 최댓값·학점·윤년 같은 판정 예제, 조건 순서 실수' },
      { num: 4, title: '반복문', areas: ['CTRL'], scope: 'for와 range(시작·끝·간격), while, break·continue, 누적 합·개수·곱, 중첩 반복(구구단·별 찍기), 반복 범위 실수(off-by-one), 무한 반복' },
      { num: 5, title: '리스트와 자료 구조', areas: ['DS'], scope: '리스트 생성·인덱싱(음수 인덱스)·슬라이싱, append·insert·pop·remove·index·count, len·sum·max·min, 리스트 순회와 enumerate, 2차원 리스트, 리스트 컴프리헨션 기초, 튜플·딕셔너리 기초(키·값, get, items)' },
      { num: 6, title: '문자열 처리', areas: ['DS'], scope: '문자열 인덱싱·슬라이싱(뒤집기 [::-1]), upper·lower·strip·split·join·replace·find·count, in 연산, ord·chr와 아스키, isdigit·isalpha·isupper, 문자 개수 세기, 회문 판별, 문자열은 바꿀 수 없음(immutable)' },
      { num: 7, title: '함수', areas: ['FUNC'], scope: 'def와 호출, 매개변수·인수, return과 여러 값 반환, 기본값 매개변수, 지역·전역 변수, 내장 함수(abs·round·sorted·len 등), COS Pro 답안 형식인 solution 함수(매개변수로 받고 return으로 답하기), 함수 속 print와 return의 차이' },
      { num: 8, title: '알고리즘과 문제 해결', areas: ['ALGO'], scope: '최댓값·최솟값 찾기, 개수 세기·빈도(딕셔너리·리스트), 정렬(sorted·sort, 버블 정렬 원리), 선형 탐색과 이진 탐색 기초, 누적 합, 시뮬레이션, 시험 유형별 전략(빈칸 채우기·한 줄 수정·함수 작성), 흔한 오류(인덱스 범위·등호 빠짐·초깃값 실수)' },
    ],
  },
  {
    id: 'data', name: 'Data', path: '/data',
    basis: 'YBM DATA(데이터분석기술평가) 2급 파이썬 수준: 데이터 이해·기초 통계·pandas 데이터 처리·집계·시각화(공식 세부 범위는 시행처 안내 기준으로 확인 필요)',
    summary: '데이터의 종류와 기초 통계부터 파이썬 pandas로 데이터를 읽고·고르고·다듬고·묶어 보고, 그래프로 해석하기까지 8단원을 단계별로 익혀요.',
    areas: [
      { id: 'CONCEPT', label: '데이터 이해' }, { id: 'STAT', label: '통계 기초' }, { id: 'PREP', label: '데이터 처리' },
      { id: 'ANAL', label: '데이터 분석' }, { id: 'VIS', label: '시각화·해석' },
    ],
    units: [
      { num: 1, title: '데이터와 데이터 분석의 이해', areas: ['CONCEPT'], scope: '데이터·정보·지식, 정형·반정형·비정형 데이터, 범주형(명목·순서)과 수치형(이산·연속), 척도(명목·서열·등간·비율), 데이터 분석 절차(문제 정의→수집→전처리→분석→시각화→해석), 데이터 수집 방법(설문·로그·공공데이터·센서), 개인정보·데이터 윤리, CSV 파일' },
      { num: 2, title: '기초 통계', areas: ['STAT'], scope: '평균·중앙값·최빈값과 쓰임, 범위·분산·표준편차, 사분위수·IQR·이상치 판단(1.5×IQR), 분포 모양(치우침), 상관관계(양·음·없음, 상관계수 −1~1, 상관과 인과의 차이), 모집단·표본' },
      { num: 3, title: '파이썬과 NumPy 기초', areas: ['PREP'], scope: '리스트·딕셔너리로 데이터 다루기, 반복으로 합계·평균 구하기, 함수, import와 별칭(import pandas as pd, import numpy as np), NumPy 배열(np.array)·벡터 연산·mean·sum·max·min·round, 배열 크기(shape)' },
      { num: 4, title: 'pandas 시작: Series와 DataFrame', areas: ['PREP'], scope: 'Series·DataFrame 만들기, read_csv(인코딩·sep 기초), head·tail·shape·info·describe·dtypes·columns, 열 하나·여러 개 선택(df[\'열\'], df[[...]]), value_counts·unique·nunique, 기본 통계 메서드(mean·sum·max·count)' },
      { num: 5, title: '데이터 선택·필터링·정렬', areas: ['ANAL'], scope: 'loc(이름)·iloc(위치) 행·열 선택, 불리언 인덱싱(조건, & | ~ 와 괄호), isin·between, sort_values(by·ascending)·sort_index, nlargest·nsmallest, reset_index, 조건에 맞는 행 개수 세기' },
      { num: 6, title: '데이터 전처리', areas: ['PREP'], scope: '결측치 확인·처리(isna·isnull·sum, dropna, fillna 평균·0), 중복(duplicated·drop_duplicates), 자료형 변환(astype, to_datetime과 dt.year·dt.month), 열 이름 바꾸기(rename)·열 삭제(drop), 파생 변수(열 계산, apply, np.where), 문자열 열 처리(str.contains·str.replace·str.upper), 이상치 처리' },
      { num: 7, title: '그룹 집계와 데이터 결합', areas: ['ANAL'], scope: 'groupby와 집계(mean·sum·count·size·agg 여러 개), 여러 열로 묶기, pivot_table(index·columns·values·aggfunc), crosstab, merge(on·how=inner·left·right·outer), concat(행·열 방향), 비율·백분율 계산' },
      { num: 8, title: '시각화와 결과 해석', areas: ['VIS'], scope: 'matplotlib·pandas plot 기초(plt.plot·bar·hist·scatter·boxplot, df.plot(kind=...)), 그래프 고르기(추세=선, 범주 비교=막대, 분포=히스토그램, 관계=산점도, 이상치=상자 그림, 비율=파이의 주의점), 제목·축 이름·범례, 그래프 읽기와 해석, 잘못된 시각화(축 자르기·3D 왜곡), 분석 결과 보고' },
    ],
  },
];
