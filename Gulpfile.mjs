import { build as esbuild } from "esbuild";
import gulp from "gulp";
import concat from "gulp-concat";
import htmlmin from "gulp-htmlmin";
import { nunjucksPrecompile } from "gulp-nunjucks";
import rename from "gulp-rename";
import uglify from "gulp-uglify";

gulp.task("scripts", () =>
	esbuild({
		entryPoints: ["./video2commons/frontend/static/video2commons.js"],
		outfile: "./video2commons/frontend/static/video2commons.min.js",
		bundle: true,
		minify: true,
		format: "esm",
		sourcemap: true,
		target: ["chrome116", "firefox124", "safari17.4"],
	}),
);

gulp.task("jinja2", () =>
	gulp
		.src([
			"./video2commons/frontend/templates/**.html",
			"!./video2commons/frontend/templates/**.min.html",
		])
		.pipe(rename({ suffix: ".min" }))
		.pipe(htmlmin({ collapseWhitespace: true, minifyCSS: true }))
		.pipe(gulp.dest("./video2commons/frontend/templates/")),
);

gulp.task("nunjucks", () =>
	gulp
		.src(["./video2commons/frontend/static/templates/**.html"])
		.pipe(htmlmin({ collapseWhitespace: true, minifyCSS: true }))
		.pipe(nunjucksPrecompile())
		.pipe(concat("../templates.min.js"))
		.pipe(uglify())
		.pipe(gulp.dest("./video2commons/frontend/static/templates")),
);

gulp.task("watch", () => {
	var changeevent = (event) => {
		console.log(`File ${event.path} was ${event.type}, running tasks...`);
	};
	gulp
		.watch(
			[
				"./video2commons/frontend/static/*.js",
				"!./video2commons/frontend/static/*.min.js",
			],
			gulp.series("scripts"),
		)
		.on("change", changeevent);

	gulp
		.watch(
			[
				"./video2commons/frontend/templates/**.html",
				"!./video2commons/frontend/templates/**.min.html",
			],
			gulp.series("jinja2"),
		)
		.on("change", changeevent);

	gulp
		.watch(
			["./video2commons/frontend/static/templates/**.html"],
			gulp.series("nunjucks"),
		)
		.on("change", changeevent);
});

gulp.task("build", gulp.series("scripts", "jinja2", "nunjucks"));

gulp.task("default", gulp.series("build", "watch"));
