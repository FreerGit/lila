import * as licon from 'common/licon';
import { clockIsRunning, formatMs } from 'common/clock';
import { fenColor } from 'common/miniBoard';
import { MaybeVNode, bind, looseH as h } from 'common/snabbdom';
import { opposite as CgOpposite, uciToMove } from 'chessground/util';
import { ChapterPreview, ChapterPreviewPlayer } from './interfaces';
import StudyCtrl from './studyCtrl';
import { GetCloudEval, MultiCloudEval, renderEvalToggle, renderScore } from './multiCloudEval';
import { Toggle, defined, toggle } from 'common';
import StudyChaptersCtrl from './studyChapters';
import { Color } from 'chessops';

export class MultiBoardCtrl {
  playing: Toggle;
  multiCloudEval: MultiCloudEval;

  constructor(
    readonly chapters: StudyChaptersCtrl,
    readonly redraw: () => void,
    readonly trans: Trans,
    send: SocketSend,
    variant: () => VariantKey,
  ) {
    this.playing = toggle(false, this.redraw);
    const currentFens = () => [];
    this.multiCloudEval = new MultiCloudEval(redraw, send, variant, currentFens);
  }
}

export function view(ctrl: MultiBoardCtrl, study: StudyCtrl): MaybeVNode {
  const cloudEval = ctrl.multiCloudEval.showEval() ? ctrl.multiCloudEval.getCloudEval : undefined;
  return h('div.study__multiboard', [
    h('div.study__multiboard__top', [
      h('div.study__multiboard__options', [
        h('button.fbt', {
          attrs: { 'data-icon': licon.Search, title: 'Search' },
          hook: bind('click', () => site.pubsub.emit('study.search.open')),
        }),
        h('label.eval', [renderEvalToggle(ctrl.multiCloudEval), ctrl.trans.noarg('showEvalBar')]),
        renderPlayingToggle(ctrl),
      ]),
    ]),
    h('div.now-playing', ctrl.chapters.list().map(makePreview(study, cloudEval))),
  ]);
}

const renderPlayingToggle = (ctrl: MultiBoardCtrl): MaybeVNode =>
  h('label.playing', [
    h('input', {
      attrs: { type: 'checkbox', checked: ctrl.playing() },
      hook: bind('change', e => ctrl.playing((e.target as HTMLInputElement).checked)),
    }),
    ctrl.trans.noarg('playing'),
  ]);

const makePreview = (study: StudyCtrl, cloudEval?: GetCloudEval) => (preview: ChapterPreview) => {
  const orientation = preview.orientation || 'white';
  return h(`a.mini-game.is2d`, [
    boardPlayer(preview, CgOpposite(orientation)),
    h('span.cg-gauge', [
      h(
        'span.mini-game__board',
        h('span.cg-wrap', {
          hook: {
            insert(vnode) {
              const el = vnode.elm as HTMLElement;
              vnode.data!.cg = site.makeChessground(el, {
                coordinates: false,
                viewOnly: true,
                fen: preview.fen,
                orientation,
                lastMove: uciToMove(preview.lastMove),
                drawable: {
                  enabled: false,
                  visible: false,
                },
              });
              vnode.data!.fen = preview.fen;
              // TODO defer click to parent, and add proper href. See relay/gameList.ts
              el.addEventListener('mousedown', _ => study.setChapter(preview.id));
            },
            postpatch(old, vnode) {
              if (old.data!.fen !== preview.fen) {
                old.data!.cg?.set({
                  fen: preview.fen,
                  lastMove: uciToMove(preview.lastMove),
                });
              }
              vnode.data!.fen = preview.fen;
              vnode.data!.cg = old.data!.cg;
            },
          },
        }),
      ),
      cloudEval && evalGauge(preview, cloudEval),
    ]),
    boardPlayer(preview, orientation),
  ]);
};

const evalGauge = (chap: ChapterPreview, cloudEval: GetCloudEval): MaybeVNode =>
  h('span.mini-game__gauge', [
    h('span.mini-game__gauge__black', {
      hook: {
        postpatch(old, vnode) {
          const prevNodeCloud = old.data?.cloud;
          const cev = cloudEval(chap.fen) || prevNodeCloud;
          if (cev?.chances != prevNodeCloud?.chances) {
            const elm = vnode.elm as HTMLElement;
            const gauge = elm.parentNode as HTMLElement;
            elm.style.height = `${((1 - (cev?.chances || 0)) / 2) * 100}%`;
            if (cev) {
              gauge.title = `${renderScore(cev)} at depth ${cev.depth}`;
              gauge.classList.add('mini-game__gauge--set');
            }
          }
          vnode.data!.cloud = cev;
        },
      },
    }),
    h('tick'),
  ]);

const userName = (u: ChapterPreviewPlayer) =>
  u.title ? [h('span.utitle', u.title), ' ' + u.name] : [u.name];

const renderPlayer = (player?: ChapterPreviewPlayer): MaybeVNode =>
  player &&
  h('span.mini-game__player', [
    h('span.mini-game__user', [
      h('span.name', userName(player)),
      player.rating && h('span.rating', ' ' + player.rating),
    ]),
  ]);

export const renderClock = (chapter: ChapterPreview, color: Color) => {
  const turnColor = fenColor(chapter.fen);
  const timeleft = computeTimeLeft(chapter, color);
  const ticking = turnColor == color && clockIsRunning(chapter.fen, color);
  return defined(timeleft)
    ? h(
        'span.mini-game__clock.mini-game__clock',
        { class: { 'clock--run': ticking } },
        formatMs(timeleft * 1000),
      )
    : '*';
};

const computeTimeLeft = (preview: ChapterPreview, color: Color): number | undefined => {
  const player = preview.players && preview.players[color];
  if (defined(player?.clock)) {
    if (defined(preview.lastMoveAt) && fenColor(preview.fen) == color) {
      const spent = (Date.now() - preview.lastMoveAt!) / 1000;
      return Math.max(0, player!.clock / 100 - spent);
    } else {
      return player!.clock / 100;
    }
  } else return;
};

const boardPlayer = (preview: ChapterPreview, color: Color) => {
  const outcome = preview.status && preview.status !== '*' ? preview.status : undefined;
  const player = preview.players && preview.players[color],
    score = outcome?.split('-')[color === 'white' ? 0 : 1];
  return h('span.mini-game__player', [
    h('span.mini-game__user', renderPlayer(player)),
    score ? h('span.mini-game__result', score) : renderClock(preview, color),
  ]);
};
