// 迁移的 transform.js
import gsap from "gsap";

function gsapTransLyric(name, duration, reverse = false, dom) {
  let gsapControl;
  if (!reverse) {
    gsapControl = gsap.fromTo(
      name,
      {
        scaleX: 1.1,
        opacity: 0.5,
      },
      {
        opacity: 1,
        scaleX: 1,
        duration,
      }
    );
  } else {
    gsapControl = gsap.fromTo(
      name,
      {
        opacity: 1,
        scaleX: 1,
        filter: `blur(0px)`,
      },
      {
        opacity: 0,
        filter: `blur(2px)`,
        scaleX: 1.1,
        duration,
        onComplete() {
          if (dom) {
            dom.style.filter = "blur(0)";
          }
        },
      }
    );
  }

  return gsapControl;
}

function gsapTransLyricLeftToRight(name, duration) {
  return gsap.fromTo(
    name,
    {
      backgroundSize: `0% 100%`,
    },
    {
      backgroundSize: `100% 100%`,
      duration,
      ease: "none",
    }
  );
}

export {
  gsapTransLyric,
  gsapTransLyricLeftToRight,
};
