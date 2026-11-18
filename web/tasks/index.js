// Task registry. To add a task: write a module exporting { id, title, category, summary, create(ctx) }
// (see README "Adding a task") and list it here.
import { click, doubleClick, rightClick } from './click.js';
import { clickSequence } from './click-sequence.js';
import { hover } from './hover.js';
import { tracePath } from './trace-path.js';
import { traceOutline } from './trace-outline.js';
import { maze } from './maze.js';
import { dragDrop } from './drag-drop.js';
import { slider } from './slider.js';
import { drawTrace } from './draw-trace.js';
import { marquee } from './marquee.js';
import { dragBins } from './drag-bins.js';
import { resize } from './resize.js';
import { rotate } from './rotate.js';
import { reorder } from './reorder.js';
import { textSelect } from './text-select.js';
import { pan } from './pan.js';
import { scrollClick } from './scroll-click.js';
import { typeText } from './type-text.js';
import { hotkey } from './hotkey.js';

export const CATEGORIES = [
  { id: 'pointing', title: 'Pointing' },
  { id: 'path', title: 'Path following' },
  { id: 'drag', title: 'Dragging' },
  { id: 'scroll', title: 'Scrolling' },
  { id: 'keyboard', title: 'Keyboard' },
];

export const TASK_LIST = [
  click, doubleClick, rightClick, clickSequence, hover,
  tracePath, traceOutline, maze,
  dragDrop, dragBins, reorder, resize, slider, rotate, pan, drawTrace, marquee, textSelect,
  scrollClick,
  typeText, hotkey,
];

export const TASKS = Object.fromEntries(TASK_LIST.map((t) => [t.id, t]));
