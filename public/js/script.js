$("#startDate").on("change", function () {
    $("#endDate").attr("min", $(this).val());
});

$("#endDate").on("change", function () {
    $("#startDate").attr("max", $(this).val());
});





