// The data the Swift port is checked against (plugins/voice/ios/Sources/VoiceTurn.swift).
//
// VoiceTurn.swift is a transliteration of turn-detect.ts, and a transliteration
// is only worth what proves it, so the two machines are run over the same
// buffers and their event streams compared. This file is the shared input: the
// level sequences recorded on the phone, cut to a stage, plus what the
// TypeScript machine answers over each one. The device replays the frames and
// the harness compares; tests/info/turn-replay.test.ts checks the same table
// against the fixtures it was cut from, so neither side can drift alone.
//
// Nothing here is invented. Every sequence is one stage of one recorded
// session, the same cut tests/info/turn-detect.test.ts makes, and every config
// is one the tests over there already argue for. The frames that are not
// buffers — the reset and the two playback calls — are the machine's other
// entry points, and they are here because a replay that only ever called `step`
// would let a broken one of those ship. The levels are stored as the
// linear RMS the probe wrote, not as dB: dB is `20 * log10(rms)`, one derived
// column, and keeping the raw number is what lets the test assert this table is
// still bit for bit what the fixture says.

import {
  DEFAULT_TURN_DETECT,
  createTurnDetector,
  type TurnDetectConfig,
  type TurnEvent,
} from "./turn-detect";

/** One recorded buffer: milliseconds since the session started, and its RMS. */
type Row = readonly [number, number];

/**
 * One buffer as the machine takes it, and as the device is handed it.
 *
 * `db` is -Infinity for digital silence, which JSON has no spelling for: it
 * crosses the wire as null and the Swift side reads null back as -Infinity.
 * That decode is a line of code like any other, so some frames here are
 * digitally silent on purpose.
 *
 * `reset` is not a buffer at all. It is the one call on the detector that is
 * not `step`, and a replay that never made it would let a broken `reset` ship.
 * The frame is not fed to the machine; its `db` is ignored.
 *
 * `playback` is the same idea for the other two calls: "start" is
 * `playbackStarted(atMs)` and "stop" is `playbackStopped(atMs)`, which is how
 * the immunity window is opened and closed. Also not a buffer, `db` also
 * ignored. A frame carries one of these or neither, never both.
 */
export interface ReplayFrame {
  atMs: number;
  db: number;
  reset?: true;
  playback?: "start" | "stop";
}

/**
 * One event, flattened for the wire. `silentMs` is present on `end` only, which
 * is the one event that carries a number.
 */
export interface ReplayEvent {
  atMs: number;
  type: TurnEvent["type"];
  silentMs?: number;
}

/** One run: these buffers through a machine built with this config. */
export interface ReplayCase {
  name: string;
  /** The patch, sent to the device as-is. Absent keys are the defaults. */
  config: Partial<TurnDetectConfig>;
  frames: ReplayFrame[];
  /** What turn-detect.ts answers over `frames`. The device has to match it. */
  expected: ReplayEvent[];
}

const VPIO_ON_ECHO: Row[] = [
  [16596, 0.00011555541277630256],
  [16774, 0.00012131890980526804],
  [16890, 0.00009766020957613364],
  [17098, 0.00010159367957385256],
  [17281, 0.00010230999032501133],
  [17396, 0.00009633712033974007],
  [17579, 0.00011561045539565384],
  [17695, 0.00010318507702322675],
  [17878, 0.0000957796219154261],
  [17995, 0.00010081440268550068],
  [18177, 0.0001049323327606544],
  [18295, 0.0001087998680304736],
  [18476, 0.0001942531525855884],
  [18593, 0.00665001105517149],
  [18775, 0.000093188660684973],
  [18890, 0.00009931274689733982],
  [19074, 0.0024548990186303854],
  [19191, 0.0006718926597386599],
  [19397, 0.0021142540499567986],
  [19582, 0.003640665439888835],
  [19694, 0.000005330532985681202],
  [19879, 0.0000015113233757801936],
  [19995, 0.000001965893716260325],
  [20180, 0.0000014677341368951602],
  [20295, 0.0000022427695967053296],
  [20477, 0.0000014793801028645248],
  [20594, 0.000002512313812985667],
  [20776, 0.00009322254481958225],
  [20893, 0.0000033510000321257394],
  [21075, 0.000004794402229890693],
  [21191, 0.000005638101811200613],
  [21376, 0.00007476459722965956],
  [21489, 0.00009362617129227148],
  [21696, 0.00005071670238976366],
  [21880, 0.0000053493408813665155],
  [21995, 0.0000046315058170876],
  [22179, 0.00001813611015677452],
  [22293, 0.000013298306839715224],
  [22478, 0.000002504087206034455],
  [22596, 0.0000021552025373239303],
  [22777, 0.00007585444836877286],
  [22894, 0.0000029385391826508567],
  [23076, 0.000004909310973744141],
  [23193, 0.000012220323696965352],
  [23375, 0.0000793749641161412],
  [23490, 0.00008132497168844566],
  [23674, 0.00007979459769558161],
  [23789, 0.007809379138052464],
  [23996, 0.000053712399676442146],
  [24180, 0.00024225849483627823],
  [24295, 0.011918445117771626],
  [24479, 0.0004834352002944798],
  [24597, 0.00008327817340614274],
  [24779, 0.00005092301216791384],
  [24895, 0.00003674995605251752],
  [25077, 0.0000417535993619822],
  [25194, 0.000052275267080403864],
  [25377, 0.000024779379600659013],
  [25493, 0.000031292303901864216],
  [25675, 0.000009433381819690112],
  [25791, 0.000006238918558665318],
  [25980, 0.00004032052675029263],
  [26089, 0.000019632883777376264],
  [26296, 8.289708262054774e-7],
  [26481, 0.000010633605597831776],
  [26597, 0.000016793172108009458],
  [26780, 0.0000014128023622106411],
  [26894, 0.000002171410869777901],
  [27078, 0.00004261061621946283],
  [27195, 0.00008044356218306348],
  [27377, 0.00007998503133421764],
  [27497, 0.00008279090252472088],
  [27676, 0.0000806823227321729],
  [27793, 0.00007171179458964616],
  [27975, 0.00008627798524685204],
  [28090, 0.00007757777348160744],
  [28274, 0.00008401260856771842],
  [28390, 0.00007508093403885141],
  [28595, 0.00007479859050363302],
  [28780, 0.0000700154050718993],
  [28895, 0.00008491170592606068],
  [29080, 0.000019679795514093712],
  [29194, 0.00000903288946574321],
  [29378, 0.000008325963790412061],
  [29495, 0.0000037156871712795696],
  [29677, 0.000009195706297759898],
  [29794, 0.000006146158739284147],
  [29976, 0.000007097355137375416],
  [30093, 0.00002513743493182119],
  [30275, 0.000009810427400225308],
  [30390, 3.84014526844112e-7],
  [30574, 0.0000021171183561818907],
  [30688, 0.0000022720616925653303],
  [30896, 0.0000169163122336613],
  [31079, 0.00002393361683061812],
  [31194, 0.000005982564744044794],
  [31379, 0.00005419486478785984],
  [31493, 0.00008122278086375445],
  [31678, 0.000033808890293585137],
];

const VPIO_ON_BARGE: Row[] = [
  [31794, 0.000012877455446869137],
  [31977, 0.0000020034601675433805],
  [32094, 0.0000038627899812127],
  [32276, 0.000015659821656299755],
  [32392, 0.000008243886441050563],
  [32575, 0.000002074895292025758],
  [32690, 0.000007831223229004536],
  [32876, 0.0000030822398002783302],
  [32989, 0.000005407612661656458],
  [33196, 0.000018184640794061124],
  [33380, 0.00008306136442115529],
  [33495, 0.00007954847387736662],
  [33679, 0.0000853265810292214],
  [33793, 0.00029864200041629374],
  [33978, 0.00001767796857166104],
  [34095, 0.000014035470485396218],
  [34279, 0.0014198455028235912],
  [34394, 0.012427471578121184],
  [34576, 0.00011555788660189136],
  [34693, 0.0001948532444657758],
  [34875, 0.00004275640822015703],
  [34990, 0.00001731815245875623],
  [35173, 0.00005759609484812245],
  [35289, 0.00006979885802138597],
  [35496, 0.000022888605599291623],
  [35682, 0.000008503971912432462],
  [35795, 0.000005518574198504211],
  [35979, 0.00005302867430145852],
  [36093, 0.009797961451113224],
  [36278, 0.05589764192700386],
  [36395, 0.020703047513961792],
  [36577, 0.238160640001297],
  [36694, 0.20108716189861295],
  [36875, 0.04610832780599594],
  [36992, 0.0026933581102639437],
  [37175, 0.12351451814174652],
  [37290, 0.10010953992605208],
  [37474, 0.17828863859176636],
  [37589, 0.2222428023815155],
  [37796, 0.08626271784305573],
  [37980, 0.09600848704576492],
  [38095, 0.021117668598890305],
  [38280, 0.19980405271053311],
  [38393, 0.10322465747594832],
  [38579, 0.1108381524682045],
  [38696, 0.10569438338279724],
  [38878, 0.0887928456068039],
  [38994, 0.09762860089540482],
  [39176, 0.1150018945336342],
  [39293, 0.07475253194570541],
  [39476, 0.0022779221180826426],
  [39590, 0.00013265556481201202],
  [39774, 0.00011809605348389596],
  [39889, 0.00048420496750622993],
  [40095, 0.1204383671283722],
  [40281, 0.08682389557361603],
  [40394, 0.12859870493412018],
  [40579, 0.13980595767498016],
  [40696, 0.02798459865152836],
  [40878, 0.08294925838708876],
  [40995, 0.09590455889701843],
  [41177, 0.0484205037355423],
  [41292, 0.008453640155494213],
  [41476, 0.00007773929974064231],
  [41592, 0.00008028004231164232],
  [41776, 0.000021347599613363855],
  [41890, 0.000012117771802877542],
  [42074, 0.00003246065534767695],
  [42188, 0.000036356941564008594],
  [42396, 0.000023277554646483622],
  [42580, 0.06873856484889984],
  [42694, 0.06833178550004959],
  [42878, 0.06584348529577255],
  [42993, 0.05072363466024398],
  [43178, 0.0032461427617818117],
  [43298, 0.0001010326886898838],
  [43479, 0.00006424101593438536],
  [43597, 0.00008038806117838249],
  [43776, 0.0010370039381086826],
  [43892, 0.0031694057397544384],
  [44076, 0.09214700013399124],
  [44190, 0.09687042236328124],
  [44373, 0.0021876085083931684],
  [44490, 0.00007534876931458712],
  [44696, 0.00014368660049512982],
  [44879, 0.00000940783411351731],
  [44994, 0.000007507520422223024],
  [45178, 0.00008454539783997461],
  [45293, 0.00006968434900045395],
  [45478, 0.00002929375841631554],
  [45595, 0.00002183555261581205],
  [45777, 0.00008070185867836699],
  [45893, 0.00008635063568362966],
  [46077, 0.000009011868314701132],
  [46193, 0.000005003749720344786],
  [46375, 0.000016489340850966983],
  [46490, 0.00000541183044333593],
  [46674, 0.00003104912684648298],
  [46789, 0.000001557364157633856],
  [46994, 0.000007709266355959699],
  [47180, 0.00006735572242178023],
  [47295, 0.0000701698663760908],
  [47479, 0.00007206575537566096],
  [47593, 0.00006751366890966892],
];

const VPIO_OFF_ECHO: Row[] = [
  [16556, 0.0005086087039671838],
  [16743, 0.00037920963950455194],
  [16859, 0.00036412396002560854],
  [17046, 0.0003966448421124369],
  [17256, 0.0004835264990106225],
  [17444, 0.0004016210732515902],
  [17559, 0.000371008412912488],
  [17746, 0.00031591037986800075],
  [17956, 0.0004830720426980406],
  [18142, 0.00038085709093138576],
  [18259, 0.0003533602284733206],
  [18446, 0.00031348312040790915],
  [18657, 0.00035448066773824394],
  [18842, 0.00041363268974237144],
  [18959, 0.00045856079668737953],
  [19145, 0.00036713815643452113],
  [19356, 0.00047949852887541056],
  [19542, 0.0005860723904334009],
  [19662, 0.0006120139150880277],
  [19846, 0.0007199074025265872],
  [20056, 0.0009674759930931032],
  [20242, 0.0007184214191511273],
  [20359, 0.0008990659262053668],
  [20546, 0.0007609478197991848],
  [20755, 0.000588645285461098],
  [20942, 0.0006635348545387387],
  [21059, 0.0007191894110292196],
  [21246, 0.0005314262234605849],
  [21455, 0.0006070139934308827],
  [21642, 0.000685222155880183],
  [21759, 0.0006893749814480543],
  [21945, 0.0008322033099830151],
  [22157, 0.0006620450294576585],
  [22342, 0.0007858164026401937],
  [22459, 0.0010308385826647282],
  [22645, 0.0011382693191990256],
  [22856, 0.001464165048673749],
  [23042, 0.0011320707853883505],
  [23159, 0.0010547195561230185],
  [23346, 0.0008067154558375479],
  [23555, 0.0008666777284815907],
  [23742, 0.0009444483439438044],
  [23859, 0.0006872893427498639],
  [24049, 0.0007072228472679853],
  [24256, 0.0005091922939755023],
  [24442, 0.0006875315448269248],
  [24559, 0.0006658827769570053],
  [24746, 0.0008262229966931045],
  [24956, 0.0008208969957195222],
  [25142, 0.0008700972539372742],
  [25259, 0.0009865114698186517],
  [25445, 0.0008504670695401728],
  [25655, 0.0009806144516915083],
  [25842, 0.0010981827508658173],
  [25964, 0.0010660659754648805],
  [26145, 0.0009761744295246899],
  [26356, 0.0013203996932134032],
  [26542, 0.0014152931980788708],
  [26659, 0.001164068467915058],
  [26845, 0.0012097165454179049],
  [27056, 0.0010193915804848077],
  [27242, 0.0008698912570253015],
  [27359, 0.0010248926701024177],
  [27546, 0.0007654197979718447],
  [27755, 0.0008405932458117605],
  [27942, 0.0007579642115160823],
  [28059, 0.0006696649943478405],
  [28245, 0.0004970586742274463],
  [28455, 0.0006486789789050817],
  [28642, 0.00045438981032930315],
  [28759, 0.0005384885589592159],
  [28945, 0.0005750084528699517],
  [29155, 0.00046901180758140987],
  [29344, 0.0004137008509133011],
  [29458, 0.0005029038875363767],
  [29645, 0.0006070418166927993],
  [29855, 0.0005693812272511423],
  [30042, 0.0005789092392660677],
  [30159, 0.0004158587544225156],
  [30346, 0.0004577018844429403],
  [30556, 0.00029530227766372263],
  [30742, 0.0006280899397097528],
  [30861, 0.0004204537835903466],
  [31046, 0.0006190076819621027],
  [31267, 0.000387286941986531],
  [31442, 0.0004064182576257735],
  [31559, 0.00035056035267189145],
  [31746, 0.0003719707019627094],
  [31955, 0.00039822206599637866],
  [32143, 0.00035154863144271076],
  [32264, 0.000411949644330889],
];

const VPIO_OFF_BARGE: Row[] = [
  [32445, 0.0003762254782486707],
  [32655, 0.0003009905922226608],
  [32842, 0.00030963702010922134],
  [32959, 0.00043923984048888087],
  [33145, 0.0004262570291757584],
  [33355, 0.0004519720387179405],
  [33542, 0.0003653627063613385],
  [33659, 0.00030462921131402254],
  [33845, 0.0003640576323959976],
  [34055, 0.0014337265165522697],
  [34242, 0.016554394736886024],
  [34359, 0.013931247405707836],
  [34545, 0.013626554980874062],
  [34755, 0.011033997870981692],
  [34943, 0.012273042462766172],
  [35059, 0.0039370013400912285],
  [35245, 0.005314748268574476],
  [35455, 0.016875091940164566],
  [35642, 0.013173759914934635],
  [35759, 0.008056581020355225],
  [35946, 0.01125665195286274],
  [36155, 0.011833308264613152],
  [36342, 0.009754468686878681],
  [36459, 0.008751659654080868],
  [36645, 0.007303235586732626],
  [36855, 0.010468922555446625],
  [37041, 0.00830873940140009],
  [37161, 0.011019538156688212],
  [37348, 0.003975554835051298],
  [37556, 0.008340735919773579],
  [37745, 0.008885649032890797],
  [37860, 0.004194145556539297],
  [38045, 0.00977618433535099],
  [38256, 0.010718981735408306],
  [38443, 0.004405878949910402],
  [38559, 0.00716534024104476],
  [38746, 0.0059638251550495625],
  [38955, 0.011482428759336472],
  [39142, 0.004707044921815395],
  [39258, 0.010330094955861568],
  [39445, 0.008329044096171856],
  [39655, 0.0030716562177985907],
  [39842, 0.005894652102142572],
  [39959, 0.005787038244307041],
  [40145, 0.007012557238340378],
  [40355, 0.0051486920565366745],
  [40543, 0.00674008671194315],
  [40659, 0.0043023452162742615],
  [40845, 0.013003232888877392],
  [41055, 0.003830552799627185],
  [41242, 0.0032969084568321705],
  [41359, 0.0004353214462753386],
  [41545, 0.0004481701471377164],
  [41755, 0.00044668340706266463],
  [41941, 0.0013597712386399508],
  [42059, 0.014245876111090183],
  [42245, 0.007826493121683598],
  [42457, 0.01627289690077305],
  [42642, 0.006153280846774578],
  [42758, 0.00818688329309225],
  [42945, 0.008606319315731525],
  [43155, 0.009410517290234566],
  [43342, 0.006381832528859377],
  [43458, 0.005429121665656567],
  [43645, 0.009793790988624096],
  [43856, 0.006606193259358406],
  [44042, 0.006217038258910179],
  [44158, 0.0029722130857408047],
  [44345, 0.007548213470727204],
  [44557, 0.0028755120001733303],
  [44742, 0.005202163476496935],
  [44859, 0.00466674380004406],
  [45045, 0.0035726341884583235],
  [45255, 0.012168454006314278],
  [45441, 0.004365685861557722],
  [45558, 0.0019202444236725569],
  [45748, 0.007388446480035783],
  [45955, 0.012395960278809072],
  [46142, 0.012044702656567097],
  [46258, 0.00620289845392108],
  [46445, 0.007395313587039709],
  [46655, 0.0061599318869411945],
  [46842, 0.0036706996615976095],
  [46958, 0.0004992472822777927],
  [47145, 0.005694097839295864],
];

// The phone talking to itself, 2026-09-05, on the run the immunity window was
// sized from: 21.8 seconds of the `played` stage, mic open, VPIO on, speaker.
// Four of these buffers cross -35 dBFS and all four are in the first 1.6 s,
// while VPIO is still converging; nothing after 5188 ms reaches -45 dB. The
// stage marker below is the playback's start, and it is what
// `playbackStarted` is called with.
const PLAYED_2026_09_05_START = 3609.565019607544;

const PLAYED_2026_09_05: Row[] = [
  [3692.2320127487183, 0.00012272932508494705],
  [3808.140993118286, 0.00012801695265807211],
  [3900.3560543060303, 0.006538753397762775],
  [3992.771983146667, 0.001275977585464716],
  [4109.361052513123, 0.00996206421405077],
  [4200.448989868164, 0.03686559945344925],
  [4291.089057922363, 0.013146597892045976],
  [4407.647013664246, 0.013521253131330012],
  [4499.283075332642, 0.00026947056176140904],
  [4590.524077415466, 8.2341481174808e-5],
  [4706.115007400513, 0.00011774936865549536],
  [4797.950029373169, 0.00012826742022298276],
  [4889.500975608826, 0.020211393013596535],
  [5005.522012710571, 0.025942834094166756],
  [5098.137974739075, 0.014055619947612286],
  [5187.829971313477, 0.020916741341352463],
  [5303.228974342346, 0.005207980051636696],
  [5395.972967147827, 0.0006639949278905988],
  [5510.814070701599, 0.0006045903428457677],
  [5602.090001106262, 0.0004579859087243676],
  [5693.713068962097, 0.0003084797353949398],
  [5808.590054512024, 0.00025961370556615293],
  [5901.4610052108765, 0.00021794121130369604],
  [5993.390083312988, 0.00014664448099210858],
  [6108.492970466614, 0.00028822082094848156],
  [6201.202988624573, 0.00017049830057658255],
  [6292.9980754852295, 0.00011471532343421131],
  [6408.3510637283325, 6.70676126901526e-6],
  [6498.589038848877, 6.3901511566655245e-6],
  [6592.200994491577, 6.279070657910779e-5],
  [6708.0090045928955, 0.004070821218192577],
  [6798.545002937317, 0.0005861523095518351],
  [6889.816045761108, 0.00017451353778596967],
  [7006.469011306763, 0.00023080751998350024],
  [7098.563075065613, 0.0002749707200564444],
  [7188.464999198914, 9.404563024872914e-5],
  [7303.539991378784, 6.746139843016863e-5],
  [7396.399974822998, 0.00010331028170185164],
  [7487.588047981262, 0.0004591105971485376],
  [7603.37507724762, 0.00014756213931832465],
  [7696.768045425415, 2.6705372874857854e-5],
  [7809.545993804932, 4.821305083169136e-6],
  [7901.584029197693, 5.76506536162924e-5],
  [7994.0550327301025, 4.091758455615491e-5],
  [8108.932971954346, 0.0003997262101620436],
  [8201.135993003845, 0.00011176606494700536],
  [8293.848037719727, 0.00012489147775340825],
  [8407.979011535645, 0.00012818266986869276],
  [8496.551990509033, 0.0014805069658905268],
  [8590.689063072205, 0.00012828521721530706],
  [8709.519982337952, 0.0001216331947944127],
  [8799.015045166016, 0.00015584818902425468],
  [8890.863060951233, 0.00022532642469741404],
  [9008.242011070251, 0.0002071034105028957],
  [9098.028063774109, 0.0001920146023621783],
  [9189.257025718687, 2.98366358038038e-5],
  [9306.897044181824, 1.1842727872135583e-5],
  [9397.709012031555, 6.5996814555546734e-6],
  [9489.29500579834, 3.9182168620754965e-6],
  [9604.742050170898, 6.21502431386034e-6],
  [9696.613073349, 6.82779091221164e-6],
  [9787.708044052124, 6.380690319929272e-5],
  [9903.356075286863, 1.0811823813128283e-5],
  [9996.345043182371, 4.563209586194716e-6],
  [10110.06200313568, 6.423760623874841e-6],
  [10202.107071876526, 6.8429681050474755e-6],
  [10293.74098777771, 5.547855380427791e-6],
  [10409.224033355713, 7.138032742659561e-6],
  [10501.321077346802, 7.175885912147351e-6],
  [10593.276023864746, 7.144619758037152e-6],
  [10708.343029022217, 7.993306098796893e-6],
  [10800.03297328949, 5.252549726719735e-6],
  [10893.03708076477, 5.060684998170473e-6],
  [11009.206056594849, 7.369397735601524e-6],
  [11099.379062652588, 7.373804237431614e-6],
  [11190.973043441772, 1.2626591342268512e-5],
  [11307.25598335266, 0.0001528806023998186],
  [11398.77200126648, 0.00016151553427334875],
  [11489.26305770874, 0.0001882261858554557],
  [11607.3579788208, 0.0001155767749878578],
  [11697.79407978058, 7.323025783989579e-6],
  [11789.24798965454, 8.162328413163777e-6],
  [11904.381036758425, 7.427254331560107e-6],
  [11997.863054275513, 4.531234026217135e-6],
  [12087.705969810486, 6.18252624917659e-6],
  [12203.33707332611, 5.981120466458378e-6],
  [12295.735001564026, 6.051998752809595e-6],
  [12410.171031951904, 6.7955370468553156e-6],
  [12501.981973648071, 6.11915174886235e-6],
  [12595.14307975769, 8.097981663013343e-6],
  [12708.890080451964, 7.935594112495892e-6],
  [12801.738977432253, 6.217695499799447e-6],
  [12892.966032028198, 5.29604858456878e-6],
  [13007.346034049988, 4.807042842003284e-6],
  [13099.971055984495, 5.817889359605033e-6],
  [13192.434072494509, 6.959669917705469e-6],
  [13309.208989143372, 6.190369276737329e-6],
  [13399.77204799652, 5.911266725888709e-6],
  [13491.69099330902, 2.6423497274663532e-6],
  [13607.554078102112, 3.829345132544404e-6],
  [13698.485970497131, 5.113112365506822e-6],
  [13789.777040481567, 5.612793756881729e-6],
  [13905.99501132965, 6.190258318383712e-6],
  [13998.844981193542, 4.7789158088562544e-6],
  [14089.233040809631, 6.370589744619792e-6],
  [14203.485012054443, 6.492479769804049e-6],
  [14297.343015670776, 6.818973815825302e-6],
  [14386.852025985718, 7.485197784262709e-6],
  [14503.828048706057, 6.2272747527458705e-6],
  [14595.550060272217, 5.208784841670422e-6],
  [14709.77807044983, 5.984693416394293e-6],
  [14802.36804485321, 5.6292769841093104e-6],
  [14894.029021263124, 7.202851520560216e-6],
  [15009.36198234558, 6.2384174270846415e-6],
  [15101.755023002625, 5.305765171215171e-6],
  [15192.24500656128, 6.299895630945684e-6],
  [15308.86697769165, 0.00010369205847382544],
  [15400.905966758728, 4.682564758695662e-5],
  [15492.182970046995, 5.537021479540272e-6],
  [15607.825994491575, 5.616686848952668e-6],
  [15697.277069091797, 2.3035721824271604e-5],
  [15790.739059448242, 0.00024317498900927603],
  [15907.863974571228, 0.00022500910563394427],
  [15998.143076896667, 0.00018175992590840903],
  [16089.761972427368, 4.2754072637762874e-5],
  [16207.382082939148, 4.852961410506396e-6],
  [16297.52504825592, 6.040022526576649e-6],
  [16388.853073120117, 5.490966486831894e-6],
  [16503.538966178894, 6.134409431979293e-6],
  [16597.36204147339, 0.00011487175652291626],
  [16687.4920129776, 0.0002547202748246491],
  [16802.37901210785, 0.00012668120325542986],
  [16895.608067512512, 8.36029266793048e-6],
  [17009.688019752502, 5.790033355879132e-6],
  [17101.96304321289, 6.081015271774959e-6],
  [17193.917989730835, 0.0001362004259135574],
  [17308.837056159973, 0.00021038345585111529],
  [17401.427030563354, 0.0002147930645151064],
  [17492.825031280518, 0.0002187252539442852],
  [17608.826994895935, 0.0002448532322887331],
  [17700.072050094604, 0.00023841645452193916],
  [17791.54896736145, 0.00019528412667568773],
  [17908.194065093994, 0.00014003737305756658],
  [17998.682022094727, 6.953474439796992e-6],
  [18091.153979301453, 5.89678074902622e-6],
  [18206.932067871097, 5.3215439947962295e-6],
  [18298.699975013733, 6.188007318996824e-6],
  [18389.288067817688, 5.146638613950927e-6],
  [18506.950974464417, 6.073209078749642e-6],
  [18597.460985183716, 0.00013925888924859464],
  [18688.525080680847, 0.00024281456717289984],
  [18804.404973983765, 0.00013076075993012637],
  [18896.47603034973, 6.45491400064202e-6],
  [18988.50107192993, 3.9636493056605104e-6],
  [19102.941036224365, 1.411255288985558e-5],
  [19195.755004882812, 2.81465622720134e-6],
  [19310.232043266296, 3.703869197124732e-6],
  [19402.00400352478, 4.1988241719082e-6],
  [19493.743062019348, 5.5846576287876815e-6],
  [19608.864068984985, 5.971152495476417e-5],
  [19701.34699344635, 0.00016805306950118393],
  [19792.45507717133, 0.000182238727575168],
  [19908.59007835388, 0.00019654184870887548],
  [19999.373078346252, 0.00018293385801371187],
  [20091.556072235107, 7.782708962622564e-6],
  [20208.401083946228, 5.723623871745076e-6],
  [20299.47304725647, 5.578400305239484e-6],
  [20391.700983047485, 5.984609288134379e-6],
  [20507.49397277832, 6.294348622759571e-6],
  [20598.299980163574, 6.1750456552545074e-6],
  [20689.80097770691, 6.581027719221311e-6],
  [20807.13403224945, 6.089398539188551e-6],
  [20897.369027137756, 6.206418674992165e-6],
  [20988.262057304382, 6.3649858930148184e-6],
  [21104.145050048828, 5.690002581104636e-6],
  [21197.556972503666, 6.32983164905454e-6],
  [21287.31608390808, 5.21742776982137e-6],
  [21403.51104736328, 6.181924163684016e-6],
  [21495.346069335938, 5.252414212009171e-6],
  [21609.763026237488, 5.704566319764126e-6],
  [21702.4689912796, 0.0001347903598798439],
  [21793.380975723267, 0.00016709388000890613],
  [21909.64102745056, 0.00018088692741002887],
  [22001.340985298157, 0.00015095609705895183],
  [22092.786073684692, 0.0001463561202399433],
  [22208.369970321655, 6.730484892614186e-5],
  [22299.421072006226, 6.432151621993398e-6],
  [22391.79801940918, 5.798950496682664e-6],
  [22508.3509683609, 6.222713636816479e-6],
  [22599.59197044373, 5.233486717770575e-6],
  [22691.70308113098, 6.202668373589404e-6],
  [22807.321071624756, 5.7962984101322945e-6],
  [22898.43201637268, 5.560368208534783e-6],
  [22989.585041999817, 5.8352579799247906e-6],
  [23106.75597190857, 5.8889295360131655e-6],
  [23198.66704940796, 5.5104710554587655e-6],
  [23288.100004196167, 5.478307684825268e-6],
  [23404.69002723694, 5.865012553840643e-6],
  [23496.401071548466, 5.713202881452162e-6],
  [23587.457060813904, 6.914898676768644e-6],
  [23703.939080238342, 5.832070655742427e-6],
  [23795.17197608948, 6.633928478549933e-6],
  [23909.52503681183, 6.154181392048486e-6],
  [24002.537965774536, 5.603846148005687e-6],
  [24094.277024269104, 9.062613389687613e-5],
  [24209.086060523987, 0.00014685018686577678],
  [24300.955057144165, 0.00013864313950762153],
  [24392.946004867554, 0.0001420673361280933],
  [24507.251024246216, 0.0001473034790251404],
  [24599.50304031372, 0.0001512427843408659],
  [24692.42000579834, 0.00014053928316570818],
  [24809.172987937927, 0.0001361801114398986],
  [24899.639010429382, 0.00014523939171340317],
  [24990.55802822113, 0.00015192643331829458],
  [25106.62305355072, 0.0001364773779641837],
  [25197.779059410095, 0.0001470004499424249],
  [25289.89601135254, 0.00013932916044723245],
];

const SEQUENCES = {
  "vpio-on/echo": VPIO_ON_ECHO,
  "vpio-on/barge": VPIO_ON_BARGE,
  "vpio-off/echo": VPIO_OFF_ECHO,
  "vpio-off/barge": VPIO_OFF_BARGE,
  "device-2026-09-05/played": PLAYED_2026_09_05,
} as const;

export type ReplaySequence = keyof typeof SEQUENCES;

/**
 * Which recording and which stage inside it each table was cut from, so the
 * test can re-cut it and compare rather than take this file's word for it.
 * `file` is relative to docs/assets, and `shape` says which of the two on-disk
 * layouts it is — the AEC probe writes a `stages` array beside its events, the
 * device run marks its stages with events of their own.
 */
export const REPLAY_SOURCES: Record<
  ReplaySequence,
  { file: string; stage: string; shape: "probe" | "device-run" }
> = {
  "vpio-on/echo": {
    file: "voice-probe/voice-probe-aec-vpio-on.json",
    stage: "echo",
    shape: "probe",
  },
  "vpio-on/barge": {
    file: "voice-probe/voice-probe-aec-vpio-on.json",
    stage: "barge",
    shape: "probe",
  },
  "vpio-off/echo": {
    file: "voice-probe/voice-probe-aec-vpio-off.json",
    stage: "echo",
    shape: "probe",
  },
  "vpio-off/barge": {
    file: "voice-probe/voice-probe-aec-vpio-off.json",
    stage: "barge",
    shape: "probe",
  },
  "device-2026-09-05/played": {
    file: "voice-device-run/turn-result-2026-09-05.json",
    stage: "played",
    shape: "device-run",
  },
};

/**
 * The buffers of one sequence, in dBFS. `20 * log10(rms)`, and -Infinity for a
 * digitally silent buffer — which none of these recordings contains, so the
 * branch is here for the shape of the type rather than for the data.
 *
 * dB is computed here and never on the device: it is the only place the two
 * languages could disagree in the last bit of a float, and a threshold
 * comparison is exactly where that would show. What crosses the wire is the
 * number the comparison is made against.
 */
export function replayFrames(name: ReplaySequence): ReplayFrame[] {
  return SEQUENCES[name].map(([atMs, rms]) => ({
    atMs,
    db: rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY,
  }));
}

/** What turn-detect.ts announces over these frames, stamped and flattened. */
export function replayExpected(
  frames: ReplayFrame[],
  config: Partial<TurnDetectConfig>,
): ReplayEvent[] {
  const detector = createTurnDetector(config);
  const out: ReplayEvent[] = [];
  for (const frame of frames) {
    if (frame.reset) {
      detector.reset();
      continue;
    }
    if (frame.playback) {
      if (frame.playback === "start") detector.playbackStarted(frame.atMs);
      else detector.playbackStopped(frame.atMs);
      continue;
    }
    const event = detector.step(frame.db, frame.atMs);
    if (!event) continue;
    out.push(
      event.type === "end"
        ? { atMs: frame.atMs, type: "end", silentMs: event.silentMs }
        : { atMs: frame.atMs, type: event.type },
    );
  }
  return out;
}

/**
 * The runs. One line per question the ported machine has to answer the same way
 * as the original, and every config on it is one tests/info/turn-detect.test.ts
 * already argues from data.
 */
const PLAN: {
  name: string;
  sequence: ReplaySequence;
  config: Partial<TurnDetectConfig>;
  /**
   * When the playback of this sequence began, for the runs that have one. The
   * case is fed `playbackStarted(atMs)` before its first buffer; absent, the
   * machine is never told about a playback and no window ever opens.
   */
  playbackStartedAtMs?: number;
}[] = [
  // Fifteen seconds of the companion's own voice, and the defaults ignore all
  // of it. The one case whose right answer is an empty list.
  { name: "echo-default", sequence: "vpio-on/echo", config: {} },
  // The recorded barge-in at the defaults: one turn, and an `end` whose
  // silentMs is above the configured hangover because no buffer landed on it.
  { name: "barge-default", sequence: "vpio-on/barge", config: {} },
  // The same barge-in at the hangover this default replaced, which is the only
  // recorded run that produces all four events: the two mid-sentence pauses cut
  // it into two turns and the tail of it ducks and resumes.
  { name: "barge-hangover-800", sequence: "vpio-on/barge", config: { hangoverMs: 800 } },
  // A threshold the echo tail crosses. Three ducks, three resumes, no stop:
  // the confirm window at work on real audio.
  { name: "echo-loose-50", sequence: "vpio-on/echo", config: { startDb: -50 } },
  // The second frame at the same threshold, which holds the echo out entirely.
  {
    name: "echo-loose-50-two-frames",
    sequence: "vpio-on/echo",
    config: { startDb: -50, startFrames: 2 },
  },
  // Five dB lower, where two consecutive echo buffers do occur.
  {
    name: "echo-loose-55-two-frames",
    sequence: "vpio-on/echo",
    config: { startDb: -55, startFrames: 2 },
  },
  // And the person still takes the turn at the loosened threshold.
  {
    name: "barge-loose-50-two-frames",
    sequence: "vpio-on/barge",
    config: { startDb: -50, startFrames: 2 },
  },
  // The resume guard on real echo: two crossings 115 ms apart are one wobble
  // with it and two without.
  { name: "echo-guard-45", sequence: "vpio-on/echo", config: { startDb: -45 } },
  {
    name: "echo-guard-45-open",
    sequence: "vpio-on/echo",
    config: { startDb: -45, resumeGuardMs: 0 },
  },
  // The control session, where the whole scale sits 20 dB lower: at the default
  // the machine is deaf to a person who really did speak.
  { name: "vpio-off-barge-default", sequence: "vpio-off/barge", config: {} },
  // Dropped far enough to hear them, which is also far enough to hear the
  // phone itself — the two cases below are the ones that reach `stop` on echo.
  { name: "vpio-off-barge-60", sequence: "vpio-off/barge", config: { startDb: -60 } },
  { name: "vpio-off-echo-60", sequence: "vpio-off/echo", config: { startDb: -60 } },
  {
    name: "vpio-off-echo-60-two-frames",
    sequence: "vpio-off/echo",
    config: { startDb: -60, startFrames: 2 },
  },
  // The immunity window on the audio it was measured from. Twenty-two seconds
  // of the phone's own voice with the window open at the right moment: four
  // buffers cross -35 dBFS, all four inside the window, and the right answer is
  // an empty list.
  {
    name: "played-immunity-default",
    sequence: "device-2026-09-05/played",
    config: {},
    playbackStartedAtMs: PLAYED_2026_09_05_START,
  },
  // The same buffers with the window shut, which is what shipped before this:
  // every one of those four leaks is a duck on the companion's own voice.
  {
    name: "played-immunity-0",
    sequence: "device-2026-09-05/played",
    config: { immunityMs: 0 },
    playbackStartedAtMs: PLAYED_2026_09_05_START,
  },
  // And a window too short for this phone. The last leak lands 1578 ms after
  // the playback started, so at 1500 the same frame that is ignored above ducks
  // — which is the margin the 2000 ms default is buying, stated as the case
  // that fails without it.
  {
    name: "played-immunity-1500",
    sequence: "device-2026-09-05/played",
    config: { immunityMs: 1500 },
    playbackStartedAtMs: PLAYED_2026_09_05_START,
  },
];

// The recorded runs above cannot fail a comparison the machine gets wrong at
// the line. Every one of the four thresholds is a `>=` or a `<`, and on real
// audio neither side of one is ever reached exactly: dB is `20 * log10(rms)` and
// never lands on -35, and buffers arrive 113-208 ms apart so no difference of
// two timestamps lands on 300 or on 1250. A port that wrote `>` for `>=`
// replays all thirteen of them bit for bit.
//
// Which is the wrong way round, because the caller this machine is written for
// drives it off a fixed-period timer when the tap goes quiet — and a fixed
// period is exactly what makes `atMs - lastVoiceMs` land on the hangover
// exactly. The path most likely to be taken is the path the recordings cannot
// see, and getting it wrong means a turn that never ends.
//
// So these are made up rather than recorded, and they say so. Every level is
// exactly `startDb` or digital silence, and every timestamp is a multiple of the
// period chosen so the thresholds fall on a frame.

/** Digital silence: no signal at all, not merely a quiet buffer. */
const SILENT = Number.NEGATIVE_INFINITY;

/** `n` buffers at one level, or one of the three calls that is not a buffer. */
type Run = readonly [count: number, db: number] | "reset" | "playback-start" | "playback-stop";

/**
 * What a timer produces: a frame every `periodMs` from zero, at the levels the
 * runs spell out. A "reset" or "playback-" run occupies one tick and feeds
 * nothing.
 */
function timer(periodMs: number, runs: readonly Run[]): ReplayFrame[] {
  const out: ReplayFrame[] = [];
  let atMs = 0;
  for (const run of runs) {
    if (run === "reset") {
      out.push({ atMs, db: SILENT, reset: true });
      atMs += periodMs;
      continue;
    }
    if (run === "playback-start" || run === "playback-stop") {
      out.push({ atMs, db: SILENT, playback: run === "playback-start" ? "start" : "stop" });
      atMs += periodMs;
      continue;
    }
    const [count, db] = run;
    for (let i = 0; i < count; i += 1) {
      out.push({ atMs, db });
      atMs += periodMs;
    }
  }
  return out;
}

/** The threshold the synthetic levels sit exactly on. */
const AT_THE_LINE = DEFAULT_TURN_DETECT.startDb;

const SYNTHETIC: { name: string; config: Partial<TurnDetectConfig>; frames: ReplayFrame[] }[] = [
  // A 50 ms timer, because 50 divides both 300 and 1250. The duck is at 0, the
  // frame at 300 is confirmMs after it to the millisecond, and the frame at
  // 1550 is hangoverMs after the last loud one. Three comparisons at once: a
  // `>` where `db >= startDb` belongs answers nothing at all here, a `>` on the
  // confirm turns the stop into a resume, and a `>` on the hangover moves the
  // end one frame late and its silentMs with it.
  {
    name: "timer-confirm-and-hangover-exact",
    config: {},
    frames: timer(50, [
      [7, AT_THE_LINE],
      [27, SILENT],
    ]),
  },
  // The other two comparisons, on the same 50 ms grid. The resume is resumeMs
  // after the last loud buffer exactly; the duck that follows is resumeGuardMs
  // after the resume exactly, which is the first moment the guard is over — a
  // guard written `<=` swallows it.
  {
    name: "timer-resume-and-guard-exact",
    config: {},
    frames: timer(50, [
      [1, AT_THE_LINE],
      [6, SILENT],
      [12, AT_THE_LINE],
      [26, SILENT],
    ]),
  },
  // Two seconds of a timer with no audio behind it, which is what the caller
  // sends when the tap stops delivering. Nothing may happen, and on the device
  // every one of these frames arrives as JSON null: the recorded runs never
  // contain a digitally silent buffer, so this is the only case that reads the
  // null back as -Infinity rather than as some number.
  {
    name: "timer-digital-silence",
    config: {},
    frames: timer(100, [[21, SILENT]]),
  },
  // The one entry point a replay otherwise never touches. Reset lands after a
  // resume and before a loud buffer that the resume guard would still be
  // covering, so a reset that forgot `lastResumeMs` shows up as a missing duck
  // rather than as nothing at all.
  {
    name: "reset-clears-the-guard-mid-run",
    config: {},
    frames: timer(50, [
      [1, AT_THE_LINE],
      [6, SILENT],
      "reset",
      [7, AT_THE_LINE],
      [26, SILENT],
    ]),
  },
  // The fifth comparison, on the same 50 ms grid: 2000 divides by 50, so the
  // playback starts at 0 and there are frames at 1950 and at 2000. The first is
  // inside the window and answers nothing; the second is immunityMs after the
  // start to the millisecond, which is the first moment the window is over — a
  // window written `<=` swallows it and every stamp after it moves.
  //
  // It also pins the counting rule: the loud frame at 1950 leaves loudFrames at
  // zero, so at `startFrames: 1` the duck at 2000 is a count begun after the
  // window, not one finished inside it.
  {
    name: "timer-immunity-boundary-exact",
    config: {},
    frames: timer(50, [
      "playback-start",
      [38, SILENT],
      [8, AT_THE_LINE],
      [27, SILENT],
    ]),
  },
  // The window belongs to the playback, not to the clock. The playback stops
  // 450 ms in, and the voice that follows — well inside what would have been
  // the window — takes the turn like any other: nothing is coming out of the
  // speaker, so nothing can be leaking.
  {
    name: "playback-stop-closes-the-window-early",
    config: {},
    frames: timer(50, [
      "playback-start",
      [8, SILENT],
      "playback-stop",
      [8, AT_THE_LINE],
      [27, SILENT],
    ]),
  },
  // Reset is the machine's other way back to silence, and it has to take the
  // window with it: without that, a call that ended mid-playback leaves the
  // next one deaf for the rest of a window nobody is playing into.
  {
    name: "reset-clears-the-window-mid-run",
    config: {},
    frames: timer(50, [
      "playback-start",
      [8, SILENT],
      "reset",
      [8, AT_THE_LINE],
      [27, SILENT],
    ]),
  },
];

/** Every run, with its input and the answer the device has to reproduce. */
export function turnReplayCases(): ReplayCase[] {
  const recorded = PLAN.map(({ name, sequence, config, playbackStartedAtMs }) => ({
    name,
    config,
    frames:
      playbackStartedAtMs === undefined
        ? replayFrames(sequence)
        : [
            { atMs: playbackStartedAtMs, db: SILENT, playback: "start" as const },
            ...replayFrames(sequence),
          ],
  }));
  return [...recorded, ...SYNTHETIC].map(({ name, config, frames }) => ({
    name,
    config,
    frames,
    expected: replayExpected(frames, config),
  }));
}

/** The same thing as a file, for a harness that would rather read than import. */
export function turnReplayCasesJson(): string {
  return JSON.stringify(turnReplayCases(), null, 2);
}

const show = (event: ReplayEvent): string =>
  event.type === "end" ? `end@${event.atMs} silentMs=${event.silentMs}` : `${event.type}@${event.atMs}`;

/**
 * Where two event streams part company, in lines a console can print. Empty
 * means they are the same stream. Used by the device harness against what the
 * phone answered and by the test against what a second local run answers.
 */
export function diffReplay(expected: ReplayEvent[], actual: ReplayEvent[]): string[] {
  const lines: string[] = [];
  if (expected.length !== actual.length) {
    lines.push(`length ${actual.length}, expected ${expected.length}`);
  }
  for (let i = 0; i < Math.max(expected.length, actual.length); i += 1) {
    const want = expected[i];
    const got = actual[i];
    if (!want) {
      lines.push(`#${i} extra ${show(got)}`);
      continue;
    }
    if (!got) {
      lines.push(`#${i} missing ${show(want)}`);
      continue;
    }
    if (want.type !== got.type || want.atMs !== got.atMs || want.silentMs !== got.silentMs) {
      lines.push(`#${i} got ${show(got)}, expected ${show(want)}`);
    }
  }
  return lines;
}
