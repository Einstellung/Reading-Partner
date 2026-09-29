import type { Translation } from "../types";
import type en from "./en";

export default {
  title: "設定",
  done: "完了",
  "tab.account": "アカウント",
  "tab.features": "機能",
  "tab.optional": "オプション",
  connected: "接続済み",
  save: "保存",
  signOut: "サインアウト",
  apiKey: "API キー",

  "thinking.off": "オフ",
  "thinking.low": "低",
  "thinking.medium": "中",
  "thinking.high": "高",

  "account.providers": "プロバイダ",
  "account.signInWith": "{name} でサインイン",
  "account.defaultConversation": "デフォルトの会話",
  "account.connectFirst": "デフォルトを選ぶには、先に上でプロバイダを接続してください。",
  "account.provider": "プロバイダ",
  "account.model": "モデル",
  "account.select": "選択…",
  "account.contextHint":
    "各モデルの横の数字はコンテキストウインドウです。このアプリは本を丸ごと読み込みます。ウインドウが小さいと、返信は収まるように資料を削り、何を削ったかを伝えます。",
  "account.everydayModel": "日常用モデル",
  "account.sameAsChat": "チャットと同じ",
  "account.everydayHint":
    "定型的な作業は上のモデルではなくこちらで実行されます：食事と、夜間のブリーフィングです。誰も待っていない作業なので、安いモデルでも困りません。どの作業がここに属するかはアプリが決めます。プロバイダは上と同じものを使います。",
  "account.briefing": "ブリーフィング",
  "account.screening": "選別",
  "account.analysis": "分析",
  "account.briefingHint":
    "ブリーフィングは読むかどうかに関係なく、すべてのソースから夜間に作成されます。選別はその日の見出しを読んで取得する記事を決める段階なので、低めに保つのが適切です。分析は通過した記事を読みます。",
  "account.thinking": "思考",
  "account.chat": "チャット",
  "account.lessonPrep": "授業の準備",
  "account.thinkingHint":
    "適応型モデルは質問ごとに実際にどれだけ考えるかを決めます。高いほど深く、ただし遅くなります。",
  "account.sync": "同期",

  "oauth.signInFailed": "サインインに失敗しました",
  "oauth.openFailed": "サインインページを開けませんでした",
  "oauth.invalidCode": "コードが無効です",
  "oauth.pasteHintDevice":
    "サインイン後、アドレスバー（読み込みに失敗する localhost の URL）をコピーしてここに貼り付けてください。",
  "oauth.pasteHintCode": "アクセスを許可した後に表示されるコードを貼り付けてください。",
  "oauth.opening": "サインインページを開いています…",
  "oauth.completeInBrowser": "ブラウザで認証を完了してください…",
  "oauth.withCode": "コードでサインイン",
  "oauth.pastePlaceholder": "サインインコードまたは URL を貼り付け",
  "oauth.submit": "送信",
  "oauth.signsOutOthers": "ここでサインインすると、ほかのプロバイダからサインアウトします。",
  "oauth.requestingCode": "サインインコードを取得しています…",
  "oauth.openPage": "サインインページを開く",
  "oauth.enterCode": "{url} でこのコードを入力してください。認証を待っています…",
  "oauth.cancel": "キャンセル",
  "oauth.pasteInstead": "代わりにサインイン URL を貼り付ける",
  "oauth.tryAgain": "再試行",

  "key.replace": "API キーを置き換える",
  "key.signsOutOthers": "ここでキーを保存すると、ほかのプロバイダからサインアウトします。",

  "sync.drive": "Google ドライブ",
  "sync.never": "なし",
  "sync.justNow": "たった今",
  "sync.minutesAgo": { other: "{count} 分前" },
  "sync.failed": "同期操作に失敗しました",
  "sync.notConfigured": "Google クライアントが設定されていません。",
  "sync.signIn": "Google でサインイン",
  "sync.signedOutNote":
    "前回の同期以降の内容はこのデバイスにしかありません。再度サインインすると同期が再開します。ローカルのデータは失われません。",
  "sync.pitch": "読書の進み具合、マーク、本を自分の Google ドライブに同期します。",
  "sync.completeInBrowser": "ブラウザでサインインを完了してください…",
  "sync.lastSync": "前回の同期：{time}",
  "sync.auto": "自動的に同期",
  "sync.running": "同期中…",
  "sync.now": "今すぐ同期",

  "features.general": "一般",
  "features.language": "言語",
  "features.languageAuto": "自動（表示はシステム、AI はあなたに合わせる）",
  "features.languageHint":
    "アプリの表示言語であり、AI が書くすべての言語です：チャットの返信、ノート、ニュースのブリーフィング。自動では、アプリはシステムの言語で表示され、AI はあなたが書いた言語で答えます。音声の文字起こしは常に話した言語に従います。",
  "features.paper": "紙の背景",
  "features.paperHint":
    "アプリ全体の背後の白――チャット、本棚、サイドバー、このダイアログ、本のページ――を生成り色の紙の色にします。色は一種類で、より暗い段階はありません。ダークモードではありません。この選択はこのデバイスにだけ保存されます。",
  "features.reading": "読書",
  "features.fingerDraw": "指で描く",
  "features.fingerDrawHint":
    "オフのときは、どのツールを選んでいても指はページを動かすだけで、マークはスタイラスで付けます。スタイラスのないデバイスではオンにして、指でもハイライトや描画ができるようにします。リーダーのナビゲーションロックはどちらよりも優先されます。スタイラスの有無はデバイスごとの性質なので、この設定はこのデバイスにだけ保存されます。",
  "features.briefing": "ブリーフィング",
  "features.collect": "このコンピュータでソースを収集",
  "features.collectHint":
    "各ソースはそれぞれのスケジュールで確認され、公開された内容はその日のブリーフィングが作られるまで保持されます。オフにすると、このマシンは収集を完全に停止し、ほかに収集するマシンがあればそちらが引き継ぎます。",
  "features.thisComputer": "このコンピュータ",
  "features.role": "このマシンの役割",
  "features.roleCollector": "収集用――ここでソースを読む",
  "features.roleReader": "閲覧用――別のマシンが収集したものを読む",
  "features.roleHint":
    "収集用マシンは購読中のサイトを一日中読み、ほかのデバイス向けにブリーフィングを公開します。閲覧用マシンは収集用マシンが公開したものを表示し、自分でサイトから取得することはありません。スマートフォンとタブレットは常に閲覧用です。2 台が収集している場合は、最も長く動いているほうが作業します。",
  "features.autostart": "コンピュータの起動時に Reading Partner を起動",
  "features.autostartHint":
    "デフォルトはオフです。一日中ソースを収集させたいマシンでオンにしてください。トレイと組み合わせれば、アプリを開いたかどうかに関係なくブリーフィングが作成されます。この設定はこのコンピュータのもので、ほかのデバイスには引き継がれません。",

  "optional.intro":
    "外部サービスのキーで、どれも任意です。2 つの音声キーはこのデバイスの認証情報と一緒に保存され、同期されないため、デバイスごとに設定が必要です。",
  "optional.meals": "食事",
  "optional.mealsHint":
    "一週間の朝食・昼食・夕食を計画し、買い物リストを管理し、ほかのものを食べたときはそう伝えられます。",
  "optional.lessonPrep": "授業の準備",
  "optional.s2Key": "Semantic Scholar API キー",
  "optional.s2Placeholder": "任意",
  "optional.s2Hint":
    "semanticscholar.org の無料キーを使うと、論文の取得が止まる原因になる共有レート制限を避けられます。",
  "optional.voiceInput": "音声入力",
  "optional.voiceOutput": "音声出力",
  "optional.dictationLanguage": "音声入力の言語",
  "optional.dictationHint":
    "バーを押したまま話すときに iPhone が聞き取る言語です。音声はスマートフォン上で文字起こしされ、アップロードされません。ほかの言語で話すと、雑な文字起こしではなく、もっともらしい誤った文章になります。実際に話す言語に設定してください。",
  "optional.speechKey": "音声合成 API キー",
  "optional.speechKeyReplace": "音声合成 API キーを置き換える",
  "optional.speechHint":
    "回答を読み上げる音声用の Xiaomi MiMo のキーです。なくてもアプリは声を出さないだけで、ほかはすべて今までどおり動きます。",
  "optional.sttKey": "音声認識 API キー",
  "optional.sttKeyReplace": "音声認識 API キーを置き換える",
  "optional.model": "モデル",
  "optional.baseUrl": "ベース URL",
  "optional.sttHint":
    "チャット欄のマイクを押したまま話します。SiliconFlow の SenseVoice プランは無料で、API キーはそのまま使えます。OpenAI 互換の文字起こしエンドポイントならどれでも使えます。",
  "features.showMarks": "携帯の読書画面でマークを表示",
  "features.showMarksHint": "ページにハイライトと AI の下線を表示します。オフにするとページはすっきりします。マークは本と「マーク」一覧に残り、新しく引くとこの設定は自動でオンに戻ります。読書画面の「表示」シートにも同じスイッチがあり、この携帯だけに適用されます。",
} satisfies Translation<typeof en>;
