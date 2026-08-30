// The data the Swift port is checked against (plugins/voice/ios/Sources/VoiceTurn.swift).
//
// VoiceTurn.swift is a transliteration of turn-detect.ts, and a transliteration
// is only worth what proves it, so the two machines are run over the same
// buffers and their event streams compared. This file is the shared input: the
// level sequences the probe recorded on the phone, cut to a stage, plus what the
// TypeScript machine answers over each one. The device replays the frames and
// the harness compares; tests/info/turn-replay.test.ts checks the same table
// against the fixtures it was cut from, so neither side can drift alone.
//
// Nothing here is invented. Every sequence is one stage of one recorded probe
// session, the same cut tests/info/turn-detect.test.ts makes, and every config
// is one the tests over there already argue for. The levels are stored as the
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
 */
export interface ReplayFrame {
  atMs: number;
  db: number;
  reset?: true;
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

const SEQUENCES = {
  "vpio-on/echo": VPIO_ON_ECHO,
  "vpio-on/barge": VPIO_ON_BARGE,
  "vpio-off/echo": VPIO_OFF_ECHO,
  "vpio-off/barge": VPIO_OFF_BARGE,
} as const;

export type ReplaySequence = keyof typeof SEQUENCES;

/**
 * Which probe file and which stage inside it each table was cut from, so the
 * test can re-cut it and compare rather than take this file's word for it.
 */
export const REPLAY_SOURCES: Record<ReplaySequence, { file: string; stage: string }> = {
  "vpio-on/echo": { file: "voice-probe-aec-vpio-on.json", stage: "echo" },
  "vpio-on/barge": { file: "voice-probe-aec-vpio-on.json", stage: "barge" },
  "vpio-off/echo": { file: "voice-probe-aec-vpio-off.json", stage: "echo" },
  "vpio-off/barge": { file: "voice-probe-aec-vpio-off.json", stage: "barge" },
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
const PLAN: { name: string; sequence: ReplaySequence; config: Partial<TurnDetectConfig> }[] = [
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

/** `n` buffers at one level, or the one call that is not a buffer. */
type Run = readonly [count: number, db: number] | "reset";

/**
 * What a timer produces: a frame every `periodMs` from zero, at the levels the
 * runs spell out. A "reset" run occupies one tick and feeds nothing.
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
];

/** Every run, with its input and the answer the device has to reproduce. */
export function turnReplayCases(): ReplayCase[] {
  const recorded = PLAN.map(({ name, sequence, config }) => ({
    name,
    config,
    frames: replayFrames(sequence),
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
